import XCTest
import SwiftTreeSitter
import TreeSitterRsl

final class TreeSitterRslTests: XCTestCase {
    func testCanLoadGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_rsl())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading Rsl grammar")
    }
}
