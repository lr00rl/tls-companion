// Package symkey names Go declarations the same way in the indexer and in the
// trace instrumenter, so execution traces and cross-references agree on which
// function they mean.
//
// A key is the package import path followed by the declaration path:
//
//	crypto/tls.Dial                         package-level func, var, const, or type
//	crypto/tls.Conn.Handshake               method (receiver base type, no pointer)
//	crypto/tls.clientHelloMsg.random        struct field or interface method
//	crypto/tls.init@handshake_client.go:12  init funcs, which may repeat
package symkey

import (
	"go/ast"
	"path/filepath"
	"strconv"
)

// FuncDecl returns the key of a function or method declaration.
func FuncDecl(pkgPath string, fd *ast.FuncDecl, file string, line int) string {
	if fd.Recv == nil || len(fd.Recv.List) == 0 {
		if fd.Name.Name == "init" {
			return pkgPath + ".init@" + filepath.Base(file) + ":" + strconv.Itoa(line)
		}
		return pkgPath + "." + fd.Name.Name
	}
	return pkgPath + "." + RecvBase(fd.Recv.List[0].Type) + "." + fd.Name.Name
}

// RecvBase strips pointers, parentheses, and type arguments from a receiver
// type expression and returns the base type name.
func RecvBase(e ast.Expr) string {
	switch t := e.(type) {
	case *ast.StarExpr:
		return RecvBase(t.X)
	case *ast.ParenExpr:
		return RecvBase(t.X)
	case *ast.IndexExpr:
		return RecvBase(t.X)
	case *ast.IndexListExpr:
		return RecvBase(t.X)
	case *ast.Ident:
		return t.Name
	}
	return "?"
}

// RecvDisplay renders a receiver the way Go documentation does: "*Conn" or
// "Conn", without type parameters.
func RecvDisplay(e ast.Expr) string {
	if s, ok := e.(*ast.StarExpr); ok {
		return "*" + RecvBase(s.X)
	}
	return RecvBase(e)
}
