import Cocoa

extension AppDelegate {
    func applyScale(_ s: CGFloat, keepOrigin: Bool) {
        scale = s
        let size = CGSize(width: designSize.width * s, height: designSize.height * s)
        var origin = panel.frame.origin
        if !keepOrigin { origin = savedOrigin() ?? defaultOrigin(for: size) }
        panel.setFrame(CGRect(origin: origin, size: size), display: true)
    }

    func defaultOrigin(for size: CGSize) -> CGPoint {
        let area = NSScreen.main?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
        return CGPoint(x: area.maxX - size.width - 20, y: area.minY)
    }

    func savedOrigin() -> CGPoint? {
        guard let x = defaults.object(forKey: "originX") as? Double,
              let y = defaults.object(forKey: "originY") as? Double else { return nil }
        let p = CGPoint(x: x, y: y)
        let probe = CGRect(origin: p, size: CGSize(width: 80, height: 80))
        return NSScreen.screens.contains { $0.frame.intersects(probe) } ? p : nil
    }

    func saveOrigin() {
        defaults.set(Double(panel.frame.origin.x), forKey: "originX")
        defaults.set(Double(panel.frame.origin.y), forKey: "originY")
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        buildMenu(menu)
    }

    func showMenu(_ event: NSEvent) {
        let menu = NSMenu()
        buildMenu(menu)
        NSMenu.popUpContextMenu(menu, with: event, for: webView)
    }

    func buildMenu(_ menu: NSMenu) {
        // Off is the flat 2D sticker look; on adds soft volume shading.
        let styleItem = item("立体效果（3D）", #selector(toggleStyle))
        styleItem.state = style == "3d" ? .on : .off
        menu.addItem(styleItem)
        menu.addItem(submenu("毛色", [("黑猫", "black"), ("奶牛猫", "tuxedo"), ("橘猫", "orange"), ("蓝灰猫", "grey"),
                                      ("白猫", "white"), ("三花猫", "calico")],
                             selected: coat, action: #selector(pickCoat(_:))))
        // Only coats whose stripes would show get the choice; black and white stay plain.
        if coat == "orange" || coat == "grey" {
            let striped = pattern == "tabby" || (pattern == "auto" && coat == "orange")
            menu.addItem(submenu("花纹", [("纯色", "solid"), ("虎斑条纹", "tabby")],
                                 selected: striped ? "tabby" : "solid", action: #selector(pickPattern(_:))))
        }
        let looks = NSMenuItem(title: "外观", action: nil, keyEquivalent: "")
        let lookMenu = NSMenu()
        lookMenu.addItem(submenu("眼睛颜色", [("跟随毛色", "auto"), ("金色", "gold"), ("绿色", "green"), ("蓝色", "blue"),
                                              ("琥珀色", "amber"), ("鸳鸯眼（一蓝一金）", "odd")],
                                 selected: eyeColor, action: #selector(pickEyeColor(_:))))
        lookMenu.addItem(submenu("眼睛高光", [("无", "none"), ("经典", "classic"), ("闪亮", "sparkle")],
                                 selected: eyeShine, action: #selector(pickEyeShine(_:))))
        lookMenu.addItem(submenu("项圈", [("无", "none"), ("红色铃铛", "red"), ("蓝色铃铛", "blue"), ("粉色铃铛", "pink"),
                                          ("绿色铃铛", "green")],
                                 selected: collar, action: #selector(pickCollar(_:))))
        let blushItem = item("腮红", #selector(toggleBlush))
        blushItem.state = blush ? .on : .off
        lookMenu.addItem(blushItem)
        let whiskerItem = item("胡须", #selector(toggleWhiskers))
        whiskerItem.state = whiskers ? .on : .off
        lookMenu.addItem(whiskerItem)
        looks.submenu = lookMenu
        menu.addItem(looks)
        menu.addItem(submenu("大小", [("小", 0.7), ("中", 0.9), ("大", 1.1), ("特大", 1.35)] as [(String, CGFloat)],
                             selected: scale, action: #selector(pickSize(_:))))
        menu.addItem(submenu("多久睡着", [("30 秒", 30), ("1 分钟", 60), ("3 分钟", 180), ("10 分钟", 600), ("不睡", 0)],
                             selected: sleepAfter, action: #selector(pickSleep(_:))))
        let privacyItem = item("隐私模式（不显示键名）", #selector(togglePrivacy))
        privacyItem.state = privacy ? .on : .off
        menu.addItem(privacyItem)
        menu.addItem(item("调节反应…", #selector(openSettings)))
        menu.addItem(.separator())
        menu.addItem(item("回到右下角", #selector(resetPosition)))
        menu.addItem(item(panel.isVisible ? "隐藏" : "显示", #selector(toggleVisible)))
        menu.addItem(.separator())
        if !keyboardAllowed {
            menu.addItem(item("开启「输入监控」权限…", #selector(openPrivacy)))
            menu.addItem(item("授权后重新启动", #selector(relaunch)))
            menu.addItem(.separator())
        }
        menu.addItem(item("退出 KeyCat", #selector(quit)))
    }

    private func submenu<T: Equatable>(_ title: String, _ options: [(String, T)], selected: T, action: Selector) -> NSMenuItem {
        let parent = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for (label, value) in options {
            let i = item(label, action)
            i.representedObject = value
            i.state = value == selected ? .on : .off
            sub.addItem(i)
        }
        parent.submenu = sub
        return parent
    }

    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: "")
        i.target = self
        return i
    }

    @objc func pickCoat(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? String else { return }
        coat = value
        pushOptions()
    }

    @objc func pickPattern(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? String else { return }
        pattern = value
        pushOptions()
    }

    @objc func pickEyeColor(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? String else { return }
        eyeColor = value
        pushOptions()
    }

    @objc func pickEyeShine(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? String else { return }
        eyeShine = value
        pushOptions()
    }

    @objc func pickCollar(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? String else { return }
        collar = value
        pushOptions()
    }

    @objc func openSettings() { settings.show() }

    @objc func toggleStyle() {
        style = style == "3d" ? "2d" : "3d"
        pushOptions()
    }

    @objc func toggleBlush() {
        blush.toggle()
        pushOptions()
    }

    @objc func toggleWhiskers() {
        whiskers.toggle()
        pushOptions()
    }

    @objc func pickSize(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? CGFloat else { return }
        applyScale(value, keepOrigin: true)
    }

    @objc func pickSleep(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? Int else { return }
        sleepAfter = value
        pushOptions()
    }

    @objc func togglePrivacy() {
        privacy.toggle()
        pushOptions()
    }

    @objc func resetPosition() {
        defaults.removeObject(forKey: "originX")
        defaults.removeObject(forKey: "originY")
        applyScale(scale, keepOrigin: false)
    }

    @objc func toggleVisible() {
        if panel.isVisible { panel.orderOut(nil) } else { panel.orderFrontRegardless() }
    }

    @objc func openPrivacy() {
        CGRequestListenEventAccess()
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func relaunch() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-c", "sleep 0.5; open \"$0\"", Bundle.main.bundlePath]
        try? task.run()
        NSApp.terminate(nil)
    }

    @objc func quit() { NSApp.terminate(nil) }
}
