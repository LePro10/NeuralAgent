// Holds F5 for 2 s (the alternative dictation shortcut).
import CoreGraphics
import Foundation
let src = CGEventSource(stateID: .hidSystemState)
CGEvent(keyboardEventSource: src, virtualKey: 96, keyDown: true)!.post(tap: .cghidEventTap)
Thread.sleep(forTimeInterval: 2)
CGEvent(keyboardEventSource: src, virtualKey: 96, keyDown: false)!.post(tap: .cghidEventTap)
