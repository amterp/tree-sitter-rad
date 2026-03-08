import XCTest
import SwiftTreeSitter
import TreeSitterRad

final class TreeSitterRadTests: XCTestCase {
    func testCanLoadGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_rad())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading Rad grammar")
    }
}
