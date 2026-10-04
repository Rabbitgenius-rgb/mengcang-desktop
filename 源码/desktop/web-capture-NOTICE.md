# Public capture and native attachment preview

The capture feature performs one explicit anonymous HTTP GET chain. It does not read browser profiles, cookies, authorization headers, Vault data, or AI services. HTTP(S) public addresses only; every redirect and all DNS answers are validated, with the selected DNS answer pinned to the socket lookup. Content is limited to 2 MiB after decompression, 12 seconds total, four redirects, and 50,000 output characters. The renderer receives plain text and metadata, never remote HTML. Login-only pages and JavaScript-rendered body content require manual paste. Remote images are not automatically loaded or copied.

When every local DNS answer for a public hostname is in the `198.18.0.0/15` proxy fake-IP/benchmark range, the capture checks that exact hostname's A and AAAA records through Cloudflare's fixed `https://cloudflare-dns.com/dns-query` endpoint, bootstrapped to its official `1.1.1.1` address with normal TLS certificate validation. Only the hostname and DNS record types are sent; no webpage path, query, content, or credentials enter DNS requests. Returned addresses must pass the same public-IP checks and are pinned before connecting. Literal fake-IP URLs, mixed private DNS answers and all other private/reserved ranges remain blocked. No resolver redirects are followed. The resolver response is limited to 64 KiB and four seconds, within the capture's overall deadline. Failure retains manual-paste fallback. Official references: [Cloudflare DNS JSON API](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/) and [resolver addresses](https://developers.cloudflare.com/1.1.1.1/ip-addresses/).

`html-parser.cjs` is a bundled, unmodified parse5 8.0.0 HTML5 parser and its entities dependency. It is included to keep the standalone Electron bundle independent of the development `node_modules`. Licenses are shipped beside it. References: <https://parse5.js.org/> and <https://github.com/inikulin/parse5/tree/v8.0.0>.

Rebuild the parser in an isolated temporary package directory (never replace the project's existing dependency symlink):

```sh
npm install --prefix /private/tmp/mengcang-web-capture-deps parse5@8.0.0 --ignore-scripts
node node_modules/esbuild/bin/esbuild /private/tmp/mengcang-web-capture-deps/node_modules/parse5/dist/index.js --bundle --platform=node --format=cjs --target=node22 --outfile=desktop/html-parser.cjs --legal-comments=inline
```

Native attachment preview supports real OLE Word `.doc` and HEIC/HEIF signatures up to 64 MiB on macOS. It invokes only `/usr/bin/textutil` (plain text, `-noload -nostore`) or `/usr/bin/sips` (PNG long edge at most 1600 pixels); no Office process, macros, AI, or network request is used. Inputs live in a private temporary folder removed after success or failure. Encrypted, malformed, oversized and unsupported-platform files produce explicit errors and retain the original attachment for download. DOCX is handled separately by the renderer's document reader.

Transport availability: Electron IPC, Vite development server, and Vite preview on localhost. No capture service is deployed to Sites and the browser never falls back to cross-origin page fetches. The local middleware rejects cross-origin requests and requires an explicit application header.
