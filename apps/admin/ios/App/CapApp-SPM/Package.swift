// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.3"),
        .package(name: "CapacitorCommunityKeepAwake", path: "../../../../../node_modules/.bun/@capacitor-community+keep-awake@8.0.1+9cf34ba37901b220/node_modules/@capacitor-community/keep-awake"),
        .package(name: "CapacitorCommunityTextToSpeech", path: "../../../../../node_modules/.bun/@capacitor-community+text-to-speech@8.0.2+9cf34ba37901b220/node_modules/@capacitor-community/text-to-speech"),
        .package(name: "CapacitorApp", path: "../../../../../node_modules/.bun/@capacitor+app@8.1.2+9cf34ba37901b220/node_modules/@capacitor/app"),
        .package(name: "CapacitorBrowser", path: "../../../../../node_modules/.bun/@capacitor+browser@8.0.5+9cf34ba37901b220/node_modules/@capacitor/browser"),
        .package(name: "CapacitorFilesystem", path: "../../../../../node_modules/.bun/@capacitor+filesystem@8.1.5+9cf34ba37901b220/node_modules/@capacitor/filesystem"),
        .package(name: "CapacitorHaptics", path: "../../../../../node_modules/.bun/@capacitor+haptics@8.0.2+9cf34ba37901b220/node_modules/@capacitor/haptics"),
        .package(name: "CapacitorShare", path: "../../../../../node_modules/.bun/@capacitor+share@8.0.3+9cf34ba37901b220/node_modules/@capacitor/share"),
        .package(name: "CapacitorSplashScreen", path: "../../../../../node_modules/.bun/@capacitor+splash-screen@8.0.2+9cf34ba37901b220/node_modules/@capacitor/splash-screen"),
        .package(name: "CapacitorStatusBar", path: "../../../../../node_modules/.bun/@capacitor+status-bar@8.0.4+9cf34ba37901b220/node_modules/@capacitor/status-bar"),
        .package(name: "CapgoCapacitorUpdater", path: "../../../../../node_modules/.bun/@capgo+capacitor-updater@8.53.0+9cf34ba37901b220/node_modules/@capgo/capacitor-updater")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunityKeepAwake", package: "CapacitorCommunityKeepAwake"),
                .product(name: "CapacitorCommunityTextToSpeech", package: "CapacitorCommunityTextToSpeech"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorHaptics", package: "CapacitorHaptics"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "CapacitorSplashScreen", package: "CapacitorSplashScreen"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar"),
                .product(name: "CapgoCapacitorUpdater", package: "CapgoCapacitorUpdater")
            ]
        )
    ]
)
