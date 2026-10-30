//! Images in a Claude transcript (a `Read` of a picture, pasted images, screenshots from MCP
//! tools). History and live updates carry only references (`CvImage`: id, type, size, pixel
//! size), so a long conversation full of screenshots stays small on a phone over the relay;
//! `cv_image` serves the bytes of one image when a client shows it, scaled down on request.

use std::io::{BufRead, BufReader, Cursor, Seek, SeekFrom};
use std::path::Path;

use base64::Engine;
use na_protocol::{ApiError, CvImage, CvImageData, ErrorCode};
use serde_json::Value;

use crate::core::err;

/// Largest picture sent in one answer (decoded). It travels base64 in JSON, and over the relay
/// base64 again inside a sealed envelope (~1.8×): well under the 16 MB frame limit of the relay
/// and the daemon (a bigger frame closes the whole connection).
pub const MAX_SEND: usize = 6 << 20;
/// Without a `max`, a picture over `MAX_SEND` is still scaled, to this long edge.
const FALLBACK_EDGE: u32 = 2560;
/// With a `max`, pictures heavier than this are re-encoded even when they are small enough.
const REENCODE_OVER: usize = 900 << 10;
/// Transcript lines longer than this are not read (the transcript reader skips them too).
const MAX_LINE: u64 = 12 << 20;
/// Enough base64 for any header (a JPEG's frame header can follow big metadata).
const HEAD_CHARS: usize = 88_000;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// The image blocks of a user message's content in a fixed order: top level and inside tool
/// results, as they appear. The position in this list is the `n` of an image's id.
pub fn images_in(content: &Value) -> Vec<&Value> {
    let mut out = vec![];
    for b in content.as_array().into_iter().flatten() {
        match b["type"].as_str() {
            Some("image") => out.push(b),
            Some("tool_result") => out.extend(b["content"].as_array().into_iter().flatten().filter(|c| c["type"] == "image")),
            _ => {}
        }
    }
    out
}

/// Position of block `b` in `images_in` (by identity).
pub fn index_of(images: &[&Value], b: &Value) -> Option<usize> {
    images.iter().position(|x| std::ptr::eq(*x, b))
}

fn decoded_len(data: &str) -> u64 {
    (data.trim_end_matches('=').len() as u64) * 3 / 4
}

/// The reference for image block `b`, number `n` of the line at file position `off`; `None`
/// when the transcript has no base64 bytes for it.
pub fn image_ref(b: &Value, off: u64, n: usize) -> Option<CvImage> {
    let src = &b["source"];
    if src["type"] != "base64" {
        return None;
    }
    let data = src["data"].as_str()?;
    let head = &data.as_bytes()[..data.len().min(HEAD_CHARS) / 4 * 4];
    let size = B64.decode(head).ok().and_then(|h| dims(&h));
    Some(CvImage {
        id: format!("{off}-{n}-{}", data.len()),
        media_type: src["media_type"].as_str().unwrap_or("image/png").to_string(),
        bytes: decoded_len(data),
        w: size.map(|s| s.0),
        h: size.map(|s| s.1),
    })
}

fn be16(b: &[u8], i: usize) -> Option<u32> {
    Some(u16::from_be_bytes([*b.get(i)?, *b.get(i + 1)?]) as u32)
}
fn le16(b: &[u8], i: usize) -> Option<u32> {
    Some(u16::from_le_bytes([*b.get(i)?, *b.get(i + 1)?]) as u32)
}
fn le24(b: &[u8], i: usize) -> Option<u32> {
    Some(u32::from_le_bytes([*b.get(i)?, *b.get(i + 1)?, *b.get(i + 2)?, 0]))
}

/// Pixel size from the start of a PNG, GIF, WebP or JPEG file.
pub fn dims(b: &[u8]) -> Option<(u32, u32)> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        let w = u32::from_be_bytes(b.get(16..20)?.try_into().ok()?);
        let h = u32::from_be_bytes(b.get(20..24)?.try_into().ok()?);
        return Some((w, h));
    }
    if b.starts_with(b"GIF8") {
        return Some((le16(b, 6)?, le16(b, 8)?));
    }
    if b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WEBP") {
        return match b.get(12..16)? {
            b"VP8 " => Some((le16(b, 26)? & 0x3fff, le16(b, 28)? & 0x3fff)),
            b"VP8L" => {
                let bits = u32::from_le_bytes(b.get(21..25)?.try_into().ok()?);
                Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
            }
            b"VP8X" => Some((le24(b, 24)? + 1, le24(b, 27)? + 1)),
            _ => None,
        };
    }
    if b.starts_with(&[0xff, 0xd8]) {
        let mut i = 2;
        while i + 3 < b.len() {
            if b[i] != 0xff {
                return None;
            }
            let m = b[i + 1];
            if m == 0xff {
                i += 1;
                continue;
            }
            if matches!(m, 0xd0..=0xd9 | 0x01) {
                i += 2;
                continue;
            }
            // Start of frame (not DHT, JPG, DAC): height, then width.
            if (0xc0..=0xcf).contains(&m) && !matches!(m, 0xc4 | 0xc8 | 0xcc) {
                return Some((be16(b, i + 7)?, be16(b, i + 5)?));
            }
            i += 2 + be16(b, i + 2)? as usize;
        }
    }
    None
}

/// Reads image `id` from the transcript at `path` and returns it, scaled to `max` if asked.
pub fn serve(path: &Path, id: &str, max: Option<u32>) -> Result<CvImageData, ApiError> {
    let gone = || err(ErrorCode::NotFound, "this image is no longer in the conversation");
    let mut parts = id.split('-').map(|p| p.parse::<u64>());
    let (Some(Ok(off)), Some(Ok(n)), Some(Ok(len)), None) = (parts.next(), parts.next(), parts.next(), parts.next()) else {
        return Err(err(ErrorCode::BadRequest, "bad image id"));
    };
    let mut f = std::fs::File::open(path).map_err(|_| gone())?;
    f.seek(SeekFrom::Start(off)).map_err(|_| gone())?;
    let mut line = vec![];
    BufReader::new(std::io::Read::take(f, MAX_LINE + 1)).read_until(b'\n', &mut line).map_err(|_| gone())?;
    let v: Value = serde_json::from_slice(&line).map_err(|_| gone())?;
    let images = images_in(&v["message"]["content"]);
    let src = &images.get(n as usize).ok_or_else(gone)?["source"];
    // The length guards against a different transcript at the same path (`/clear`).
    let data = src["data"].as_str().filter(|d| d.len() as u64 == len).ok_or_else(gone)?;
    let raw = B64.decode(data).map_err(|_| err(ErrorCode::Internal, "the image data is damaged"))?;
    fit(raw, src["media_type"].as_str().unwrap_or("image/png"), max)
}

/// The picture as it should travel: as it is when it is small enough, else scaled to `max`
/// (or `FALLBACK_EDGE` when too big to send) and re-encoded (JPEG, PNG if it is transparent).
pub fn fit(raw: Vec<u8>, media_type: &str, max: Option<u32>) -> Result<CvImageData, ApiError> {
    let size = dims(&raw);
    let too_big = raw.len() > MAX_SEND;
    let edge = match max {
        Some(m) => Some(m.max(64)),
        None if too_big => Some(FALLBACK_EDGE),
        None => None,
    };
    let wide = matches!((size, edge), (Some((w, h)), Some(e)) if w.max(h) > e);
    let heavy = too_big || (max.is_some() && raw.len() > REENCODE_OVER);
    let decodable = matches!(media_type, "image/png" | "image/jpeg");
    if (wide || heavy)
        && decodable
        && let Some(out) = reencode(&raw, edge)
        && (wide || out.data.len() < raw.len())
    {
        if out.data.len() > MAX_SEND {
            return Err(err(ErrorCode::BadRequest, "this image is too big to show here"));
        }
        return Ok(CvImageData { media_type: out.media_type.into(), data: B64.encode(&out.data), w: out.w, h: out.h, scaled: true });
    }
    if too_big {
        return Err(err(ErrorCode::BadRequest, "this image is too big to show here"));
    }
    let (w, h) = size.unwrap_or((0, 0));
    Ok(CvImageData { media_type: media_type.to_string(), data: B64.encode(&raw), w, h, scaled: false })
}

struct Encoded {
    data: Vec<u8>,
    media_type: &'static str,
    w: u32,
    h: u32,
}

fn reencode(raw: &[u8], edge: Option<u32>) -> Option<Encoded> {
    let mut img = image::load_from_memory(raw).ok()?;
    if let Some(e) = edge
        && img.width().max(img.height()) > e
    {
        img = img.resize(e, e, image::imageops::FilterType::Triangle);
    }
    let (w, h) = (img.width(), img.height());
    let transparent = img.color().has_alpha() && img.to_rgba8().pixels().any(|p| p[3] < 255);
    let mut data = vec![];
    if transparent {
        img.write_to(&mut Cursor::new(&mut data), image::ImageFormat::Png).ok()?;
        return Some(Encoded { data, media_type: "image/png", w, h });
    }
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut data, 84).encode_image(&img.to_rgb8()).ok()?;
    Some(Encoded { data, media_type: "image/jpeg", w, h })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn png(w: u32, h: u32, alpha: bool) -> Vec<u8> {
        let mut out = vec![];
        let img: image::DynamicImage = if alpha {
            image::RgbaImage::from_fn(w, h, |x, _| image::Rgba([(x % 256) as u8, 40, 90, if x % 2 == 0 { 255 } else { 120 }])).into()
        } else {
            image::RgbImage::from_fn(w, h, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, ((x * y) % 256) as u8])).into()
        };
        img.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png).unwrap();
        out
    }

    #[test]
    fn reads_pixel_sizes() {
        assert_eq!(dims(&png(31, 17, false)), Some((31, 17)));
        let mut jpg = vec![];
        image::codecs::jpeg::JpegEncoder::new(&mut jpg).encode_image(&image::RgbImage::new(40, 25)).unwrap();
        assert_eq!(dims(&jpg), Some((40, 25)));
        assert_eq!(dims(b"GIF89a\x0a\x00\x05\x00"), Some((10, 5)));
        assert_eq!(dims(b"not an image"), None);
    }

    #[test]
    fn serves_by_id_and_scales_for_phones() {
        let big = png(1800, 900, false);
        let small = png(20, 10, true);
        let line = json!({"type":"user","message":{"role":"user","content":[
            {"type":"text","text":"look"},
            {"type":"image","source":{"type":"base64","media_type":"image/png","data":B64.encode(&small)}},
            {"type":"tool_result","tool_use_id":"t","content":[
                {"type":"image","source":{"type":"base64","media_type":"image/png","data":B64.encode(&big)}},
                {"type":"text","text":"done"}]}]}});
        let dir = std::env::temp_dir().join(format!("na-cvimg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.jsonl");
        let first = "{\"type\":\"ai-title\",\"aiTitle\":\"x\"}\n";
        std::fs::write(&path, format!("{first}{line}\n")).unwrap();
        let off = first.len() as u64;

        let imgs = images_in(&line["message"]["content"]);
        assert_eq!(imgs.len(), 2);
        let r1 = image_ref(imgs[1], off, 1).unwrap();
        assert_eq!((r1.w, r1.h, r1.bytes), (Some(1800), Some(900), big.len() as u64));

        // Local: as it is.
        let local = serve(&path, &r1.id, None).unwrap();
        assert!(!local.scaled);
        assert_eq!(B64.decode(&local.data).unwrap(), big);
        // Remote: scaled to the long edge and re-encoded as JPEG (no transparency).
        let phone = serve(&path, &r1.id, Some(600)).unwrap();
        assert!(phone.scaled);
        assert_eq!((phone.w, phone.h, phone.media_type.as_str()), (600, 300, "image/jpeg"));
        // A small transparent PNG stays a PNG.
        let r0 = image_ref(imgs[0], off, 0).unwrap();
        let s = serve(&path, &r0.id, Some(600)).unwrap();
        assert_eq!((s.media_type.as_str(), s.w, s.h, s.scaled), ("image/png", 20, 10, false));
        // Wrong length (another transcript at the same path) or a bad id: refused.
        assert!(serve(&path, &format!("{off}-1-5"), None).is_err());
        assert!(serve(&path, "x", None).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
