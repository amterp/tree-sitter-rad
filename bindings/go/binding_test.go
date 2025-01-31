package tree_sitter_rsl_test

import (
	"testing"

	tree_sitter_rsl "github.com/amterp/tree-sitter-rsl/bindings/go"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_rsl.Language())
	if language == nil {
		t.Errorf("Error loading Rsl grammar")
	}
}
