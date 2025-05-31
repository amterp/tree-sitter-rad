package tree_sitter_rad_test

import (
	"fmt"
	rts "github.com/amterp/tree-sitter-rad/bindings/go"
	ts "github.com/tree-sitter/go-tree-sitter"
	"os"
	"testing"
)

func Test_PrintNodeKindIdTable(t *testing.T) {
	lang := ts.NewLanguage(rts.Language())

	path := "../../NODES.md"
	fmt.Printf("Writing to %s\n", path)
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("Create() failed: %v", err)
	}
	defer file.Close()

	fmt.Fprintf(file, "# Node Kinds\n\n")

	fmt.Fprintf(file, "| %3s | %-40s |\n", "Id", "Kind")
	fmt.Fprintf(file, "|-----|------------------------------------------|\n")
	for i := 0; i < int(lang.NodeKindCount()); i++ {
		fmt.Fprintf(file, "| %3d | %-40s |\n", i, fmt.Sprintf("`%s`", lang.NodeKindForId(uint16(i))))
	}

	fmt.Fprintf(file, "\n*This file is generated - don't edit manually.*\n")
}

func Test_PrintFieldIdTable(t *testing.T) {
	lang := ts.NewLanguage(rts.Language())

	path := "../../FIELDS.md"
	fmt.Printf("Writing to %s\n", path)
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("Create() failed: %v", err)
	}
	defer file.Close()

	fmt.Fprintf(file, "# Field Names\n\n")

	fmt.Fprintf(file, "| %3s | %-40s |\n", "Id", "Field")
	fmt.Fprintf(file, "|-----|------------------------------------------|\n")
	for i := 0; i < int(lang.FieldCount()); i++ {
		fmt.Fprintf(file, "| %3d | %-40s |\n", i, fmt.Sprintf("`%s`", lang.FieldNameForId(uint16(i))))
	}

	fmt.Fprintf(file, "\n*This file is generated - don't edit manually.*\n")
}
