//! Notification mails over SMTP (Brevo). Without SMTP settings mails are only recorded.

use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use parking_lot::Mutex;

use crate::config::Config;
use crate::db::User;

pub struct Mailer {
    smtp: Option<AsyncSmtpTransport<Tokio1Executor>>,
    from: Option<Mailbox>,
    public_url: String,
    /// Recipients and subjects of the last mails (no bodies), for tests and the log.
    pub sent: Mutex<Vec<(String, String)>>,
}

impl Mailer {
    pub fn new(cfg: &Config) -> Mailer {
        let smtp = cfg.smtp.as_ref().and_then(|s| {
            let b = if s.port == 465 {
                AsyncSmtpTransport::<Tokio1Executor>::relay(&s.host)
            } else {
                AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&s.host)
            };
            match b {
                Ok(b) => Some(b.port(s.port).credentials(Credentials::new(s.user.clone(), s.pass.clone())).build()),
                Err(e) => {
                    tracing::error!("SMTP settings unusable: {e}");
                    None
                }
            }
        });
        let from = format!("NeuralAgent <{}>", cfg.mail_from).parse().ok();
        Mailer { smtp, from, public_url: cfg.public_url.clone(), sent: Mutex::new(vec![]) }
    }

    async fn send(&self, to: &str, subject: &str, body: String) {
        {
            let mut s = self.sent.lock();
            if s.len() >= 50 {
                s.remove(0);
            }
            s.push((to.to_string(), subject.to_string()));
        }
        let (Some(smtp), Some(from)) = (&self.smtp, &self.from) else {
            tracing::info!(subject, "mail not configured, not sent");
            return;
        };
        let Ok(to_box) = to.parse::<Mailbox>() else {
            tracing::warn!("invalid recipient address");
            return;
        };
        let msg = match Message::builder().from(from.clone()).to(to_box).subject(subject).body(body) {
            Ok(m) => m,
            Err(e) => return tracing::warn!("mail build failed: {e}"),
        };
        match smtp.send(msg).await {
            Ok(_) => tracing::info!(subject, "mail sent"),
            Err(e) => tracing::warn!(subject, "mail failed: {e}"),
        }
    }

    pub async fn access_requested(&self, admins: &[String], u: &User) {
        let body = format!(
            "{} ({}) asks for remote access to NeuralAgent.\n\nSigned in with: {}\nMessage: {}\n\nApprove or deny: {}/admin/\n",
            u.name,
            u.email,
            u.provider,
            u.message.as_deref().unwrap_or("(none)"),
            self.public_url
        );
        for a in admins {
            self.send(a, &format!("Access request: {}", u.name), body.clone()).await;
        }
    }

    pub async fn approved(&self, u: &User) {
        let body = format!(
            "Hi {},\n\nyou're in: remote access for NeuralAgent is now switched on for {}.\n\n\
             Open NeuralAgent on your computer and go to Remote. To add your phone, use \"Add phone\" there \
             or sign in on the phone with the same account. In any browser: {}/app/\n\n— NeuralAgent\n",
            u.name, u.email, self.public_url
        );
        self.send(&u.email, "You're in: NeuralAgent remote access", body).await;
    }

    pub async fn denied(&self, u: &User) {
        let body = format!(
            "Hi {},\n\nthanks for your interest in NeuralAgent remote access. It is invite-only and we can't \
             offer it to you right now. NeuralAgent itself keeps working on your computer without an account.\n\n— NeuralAgent\n",
            u.name
        );
        self.send(&u.email, "Your NeuralAgent remote access request", body).await;
    }
}
