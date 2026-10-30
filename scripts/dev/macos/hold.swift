// Holds Option+Space for N seconds (posts real key events, like a user would).
import CoreGraphics
import Foundation
let secs = Double(CommandLine.arguments.dropFirst().first ?? "5") ?? 5
let src = CGEventSource(stateID: .hidSystemState)
func key(_ code: CGKeyCode, _ down: Bool, _ flags: CGEventFlags) {
    let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)!
    e.flags = flags
    e.post(tap: .cghidEventTap)
}
key(58, true, .maskAlternate)        // option down
key(49, true, .maskAlternate)        // space down
Thread.sleep(forTimeInterval: secs)
key(49, false, .maskAlternate)       // space up
key(58, false, [])                   // option up
