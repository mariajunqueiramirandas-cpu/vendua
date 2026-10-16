import Capacitor
import UIKit

/// The app's bridge: Capacitor's, plus the app's own plugin (VenduaShellPlugin).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VenduaShellPlugin())
    }
}
