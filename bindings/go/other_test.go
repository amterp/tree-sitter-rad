package tree_sitter_rsl_test

import (
	"fmt"
	rts "github.com/amterp/tree-sitter-rsl/bindings/go"
	ts "github.com/tree-sitter/go-tree-sitter"
	"testing"
)

func Test_PrintNodeKindIdTable(t *testing.T) {
	lang := ts.NewLanguage(rts.Language())

	fmt.Println("| Id | Kind |")
	fmt.Println("|----|------|")
	for i := 0; i < int(lang.NodeKindCount()); i++ {
		fmt.Printf("| %d | `%s` |\n", i, lang.NodeKindForId(uint16(i)))
	}
}
