package tree_sitter_rad_test

import (
	"testing"

	tree_sitter_rad "github.com/amterp/tree-sitter-rad/bindings/go"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_rad.Language())
	if language == nil {
		t.Errorf("Error loading Rad grammar")
	}
}
