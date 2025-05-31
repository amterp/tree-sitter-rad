// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "TreeSitterRad",
    products: [
        .library(name: "TreeSitterRad", targets: ["TreeSitterRad"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ChimeHQ/SwiftTreeSitter", from: "0.8.0"),
    ],
    targets: [
        .target(
            name: "TreeSitterRad",
            dependencies: [],
            path: ".",
            sources: [
                "src/parser.c",
                // NOTE: if your language has an external scanner, add it here.
            ],
            resources: [
                .copy("queries")
            ],
            publicHeadersPath: "bindings/swift",
            cSettings: [.headerSearchPath("src")]
        ),
        .testTarget(
            name: "TreeSitterRadTests",
            dependencies: [
                "SwiftTreeSitter",
                "TreeSitterRad",
            ],
            path: "bindings/swift/TreeSitterRadTests"
        )
    ],
    cLanguageStandard: .c11
)
