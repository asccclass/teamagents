package SherryServer

import (
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
)

type StaticFileServer struct {
	StaticPath string
	IndexPath  string
}

type Register_Header struct {
	Method string `header:"x-api-key" validate:"len=10"`
	Agent  string `header:"User-Agent"`
}

func (h StaticFileServer) GetHeader(r *http.Request, data interface{}) {
	value := reflect.ValueOf(data).Elem()
	valueType := reflect.TypeOf(data).Elem()
	header := r.Header
	for i := 0; i < value.NumField(); i++ {
		field := value.Field(i)
		tag := valueType.Field(i).Tag.Get("header")
		headerData, ok := header[tag]
		if ok {
			field.SetString(headerData[0])
		}
	}
}

func (h StaticFileServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	relativePath := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if relativePath == "." {
		relativePath = ""
	}
	path := filepath.Join(h.StaticPath, relativePath)

	_, err := os.Stat(path)
	if os.IsNotExist(err) {
		http.ServeFile(w, r, filepath.Join(h.StaticPath, h.IndexPath))
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	http.FileServer(http.Dir(h.StaticPath)).ServeHTTP(w, r)
}
