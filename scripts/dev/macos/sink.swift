// A plain text window that takes focus, then writes what was typed into it to a file and quits.
import AppKit
let out = CommandLine.arguments[1]
let secs = Double(CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "12") ?? 12
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let win = NSWindow(contentRect: NSRect(x: 200, y: 200, width: 640, height: 120), styleMask: [.titled], backing: .buffered, defer: false)
win.title = "Dictation sink"
let field = NSTextField(frame: NSRect(x: 10, y: 40, width: 620, height: 40))
win.contentView!.addSubview(field)
win.makeKeyAndOrderFront(nil)
win.makeFirstResponder(field)
app.activate(ignoringOtherApps: true)
DispatchQueue.main.asyncAfter(deadline: .now() + secs) {
    try? field.stringValue.write(toFile: out, atomically: true, encoding: .utf8)
    app.terminate(nil)
}
app.run()
