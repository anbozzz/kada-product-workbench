#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS

#include <winsock2.h>
#include <windows.h>
#include <shellapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <sys/stat.h>

#define REQUEST_LIMIT 16384
#define PATH_LIMIT 32768
#define STREAM_BUFFER 65536

static int send_all(SOCKET client, const char *data, size_t length) {
  while (length > 0) {
    int chunk = length > INT_MAX ? INT_MAX : (int)length;
    int sent = send(client, data, chunk, 0);
    if (sent <= 0) return 0;
    data += sent;
    length -= (size_t)sent;
  }
  return 1;
}

static void send_json(SOCKET client, int status, const char *label, const char *body, int head_only) {
  char header[512];
  int body_length = (int)strlen(body);
  int header_length = snprintf(
    header,
    sizeof(header),
    "HTTP/1.1 %d %s\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: %d\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
    status,
    label,
    body_length
  );
  if (header_length > 0) send_all(client, header, (size_t)header_length);
  if (!head_only) send_all(client, body, (size_t)body_length);
}

static int hex_value(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  return -1;
}

static int decode_url_path(const char *source, char *target, size_t capacity) {
  size_t output = 0;
  for (size_t index = 0; source[index] && source[index] != '?' && source[index] != '#'; index += 1) {
    unsigned char value = (unsigned char)source[index];
    if (value == '%') {
      int high = hex_value(source[index + 1]);
      int low = hex_value(source[index + 2]);
      if (high < 0 || low < 0) return 0;
      value = (unsigned char)((high << 4) | low);
      index += 2;
    }
    if (value == 0 || value == '\\' || output + 1 >= capacity) return 0;
    target[output++] = (char)value;
  }
  target[output] = 0;
  return 1;
}

static int safe_relative_path(const char *path) {
  const char *cursor = path;
  while (*cursor == '/') cursor += 1;
  while (*cursor) {
    const char *end = strchr(cursor, '/');
    size_t length = end ? (size_t)(end - cursor) : strlen(cursor);
    if (length == 0 || (length == 1 && cursor[0] == '.') ||
        (length == 2 && cursor[0] == '.' && cursor[1] == '.') || strchr(cursor, ':')) {
      return 0;
    }
    if (!end) break;
    cursor = end + 1;
  }
  return 1;
}

static int utf8_to_wide(const char *source, wchar_t *target, int capacity) {
  int converted = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, source, -1, target, capacity);
  return converted > 0;
}

static const char *mime_for(const wchar_t *path) {
  const wchar_t *extension = wcsrchr(path, L'.');
  if (!extension) return "application/octet-stream";
  if (_wcsicmp(extension, L".html") == 0 || _wcsicmp(extension, L".htm") == 0) return "text/html; charset=utf-8";
  if (_wcsicmp(extension, L".js") == 0 || _wcsicmp(extension, L".mjs") == 0) return "text/javascript; charset=utf-8";
  if (_wcsicmp(extension, L".css") == 0) return "text/css; charset=utf-8";
  if (_wcsicmp(extension, L".json") == 0) return "application/json; charset=utf-8";
  if (_wcsicmp(extension, L".svg") == 0) return "image/svg+xml";
  if (_wcsicmp(extension, L".png") == 0) return "image/png";
  if (_wcsicmp(extension, L".jpg") == 0 || _wcsicmp(extension, L".jpeg") == 0) return "image/jpeg";
  if (_wcsicmp(extension, L".gif") == 0) return "image/gif";
  if (_wcsicmp(extension, L".webp") == 0) return "image/webp";
  if (_wcsicmp(extension, L".ico") == 0) return "image/x-icon";
  if (_wcsicmp(extension, L".woff") == 0) return "font/woff";
  if (_wcsicmp(extension, L".woff2") == 0) return "font/woff2";
  if (_wcsicmp(extension, L".ttf") == 0) return "font/ttf";
  if (_wcsicmp(extension, L".wasm") == 0) return "application/wasm";
  if (_wcsicmp(extension, L".pdf") == 0) return "application/pdf";
  if (_wcsicmp(extension, L".txt") == 0 || _wcsicmp(extension, L".md") == 0) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

static void serve_file(SOCKET client, const wchar_t *root, const char *relative_utf8, int head_only) {
  wchar_t relative[PATH_LIMIT];
  wchar_t full_path[PATH_LIMIT];
  struct _stat64 info;
  if (!utf8_to_wide(relative_utf8, relative, PATH_LIMIT)) {
    send_json(client, 400, "Bad Request", "{\"error\":\"资源路径编码无效\"}", head_only);
    return;
  }
  if (swprintf(full_path, PATH_LIMIT, L"%ls\\%ls", root, relative) < 0) {
    send_json(client, 400, "Bad Request", "{\"error\":\"资源路径过长\"}", head_only);
    return;
  }
  for (wchar_t *cursor = full_path; *cursor; cursor += 1) {
    if (*cursor == L'/') *cursor = L'\\';
  }
  if (_wstat64(full_path, &info) == 0 && (info.st_mode & _S_IFDIR)) {
    size_t length = wcslen(full_path);
    if (length + 11 >= PATH_LIMIT) {
      send_json(client, 400, "Bad Request", "{\"error\":\"资源路径过长\"}", head_only);
      return;
    }
    wcscat(full_path, L"\\index.html");
  }
  FILE *file = _wfopen(full_path, L"rb");
  if (!file) {
    send_json(client, 404, "Not Found", "{\"error\":\"资源不存在\"}", head_only);
    return;
  }
  _fseeki64(file, 0, SEEK_END);
  long long length = _ftelli64(file);
  _fseeki64(file, 0, SEEK_SET);
  if (length < 0) {
    fclose(file);
    send_json(client, 500, "Internal Server Error", "{\"error\":\"资源无法读取\"}", head_only);
    return;
  }
  char header[512];
  int header_length = snprintf(
    header,
    sizeof(header),
    "HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %lld\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
    mime_for(full_path),
    length
  );
  if (header_length > 0) send_all(client, header, (size_t)header_length);
  if (!head_only) {
    char *buffer = (char *)malloc(STREAM_BUFFER);
    if (buffer) {
      size_t count;
      while ((count = fread(buffer, 1, STREAM_BUFFER, file)) > 0) {
        if (!send_all(client, buffer, count)) break;
      }
      free(buffer);
    }
  }
  fclose(file);
}

static void handle_client(SOCKET client, const wchar_t *root) {
  char request[REQUEST_LIMIT];
  int used = 0;
  while (used < REQUEST_LIMIT - 1) {
    int received = recv(client, request + used, REQUEST_LIMIT - 1 - used, 0);
    if (received <= 0) return;
    used += received;
    request[used] = 0;
    if (strstr(request, "\r\n\r\n")) break;
  }
  char method[8] = {0};
  char raw_path[8192] = {0};
  if (sscanf(request, "%7s %8191s", method, raw_path) != 2) {
    send_json(client, 400, "Bad Request", "{\"error\":\"请求格式无效\"}", 0);
    return;
  }
  int head_only = strcmp(method, "HEAD") == 0;
  if (strcmp(method, "GET") != 0 && !head_only) {
    send_json(client, 403, "Forbidden", "{\"code\":\"READ_ONLY_PACKAGE\",\"error\":\"当前是只读评审包，不提供写入接口\"}", 0);
    return;
  }
  char path[8192];
  if (!decode_url_path(raw_path, path, sizeof(path)) || path[0] != '/' || !safe_relative_path(path)) {
    send_json(client, 403, "Forbidden", "{\"error\":\"资源路径越界\"}", head_only);
    return;
  }
  if (strcmp(path, "/api/config") == 0) {
    serve_file(client, root, "data/config.json", head_only);
    return;
  }
  if (strncmp(path, "/api/", 5) == 0) {
    send_json(client, 403, "Forbidden", "{\"code\":\"READ_ONLY_PACKAGE\",\"error\":\"当前是只读评审包，不提供写入、项目管理、文件浏览或 Codex 接口\"}", head_only);
    return;
  }
  if (strcmp(path, "/") == 0) {
    serve_file(client, root, "web/index.html", head_only);
    return;
  }
  if (strncmp(path, "/studio-assets/", 15) == 0) {
    char relative[8192];
    snprintf(relative, sizeof(relative), "web/%s", path + 15);
    serve_file(client, root, relative, head_only);
    return;
  }
  if (strncmp(path, "/target/", 8) == 0) {
    char relative[8192];
    snprintf(relative, sizeof(relative), "pages/%s", path + 8);
    serve_file(client, root, relative, head_only);
    return;
  }
  char relative[8192];
  snprintf(relative, sizeof(relative), "pages/%s", path + 1);
  serve_file(client, root, relative, head_only);
}

int main(void) {
  SetConsoleOutputCP(CP_UTF8);
  wchar_t executable[PATH_LIMIT];
  DWORD executable_length = GetModuleFileNameW(NULL, executable, PATH_LIMIT);
  if (executable_length == 0 || executable_length >= PATH_LIMIT) {
    MessageBoxW(NULL, L"无法确定评审包目录。", L"Interactive Product Spec", MB_OK | MB_ICONERROR);
    return 1;
  }
  wchar_t *separator = wcsrchr(executable, L'\\');
  if (!separator) {
    MessageBoxW(NULL, L"无法确定评审包目录。", L"Interactive Product Spec", MB_OK | MB_ICONERROR);
    return 1;
  }
  *separator = 0;

  WSADATA winsock;
  if (WSAStartup(MAKEWORD(2, 2), &winsock) != 0) {
    MessageBoxW(NULL, L"无法启动本机网络查看器。", L"Interactive Product Spec", MB_OK | MB_ICONERROR);
    return 1;
  }
  SOCKET server = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (server == INVALID_SOCKET) {
    WSACleanup();
    return 1;
  }
  struct sockaddr_in address;
  memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = 0;
  if (bind(server, (struct sockaddr *)&address, sizeof(address)) == SOCKET_ERROR || listen(server, SOMAXCONN) == SOCKET_ERROR) {
    closesocket(server);
    WSACleanup();
    MessageBoxW(NULL, L"无法监听本机端口。", L"Interactive Product Spec", MB_OK | MB_ICONERROR);
    return 1;
  }
  int address_length = sizeof(address);
  if (getsockname(server, (struct sockaddr *)&address, &address_length) == SOCKET_ERROR) {
    closesocket(server);
    WSACleanup();
    return 1;
  }
  unsigned short port = ntohs(address.sin_port);
  wchar_t url[128];
  swprintf(url, 128, L"http://127.0.0.1:%hu/", port);
  wprintf(L"Interactive Product Spec 只读评审包已启动：%ls\n关闭此窗口即可停止。\n", url);
  ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);

  for (;;) {
    SOCKET client = accept(server, NULL, NULL);
    if (client == INVALID_SOCKET) break;
    DWORD timeout = 15000;
    setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, (const char *)&timeout, sizeof(timeout));
    setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, (const char *)&timeout, sizeof(timeout));
    handle_client(client, executable);
    shutdown(client, SD_BOTH);
    closesocket(client);
  }
  closesocket(server);
  WSACleanup();
  return 0;
}
