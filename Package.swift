// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "TreeSitterRsl",
    products: [
        .library(name: "TreeSitterRsl", targets: ["TreeSitterRsl"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ChimeHQ/SwiftTreeSitter", from: "0.8.0"),
    ],
    targets: [
        .target(
            name: "TreeSitterRsl",
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
            name: "TreeSitterRslTests",
            dependencies: [
                "SwiftTreeSitter",
                "TreeSitterRsl",
            ],
            path: "bindings/swift/TreeSitterRslTests"
        )
    ],
    cLanguageStandard: .c11
)
