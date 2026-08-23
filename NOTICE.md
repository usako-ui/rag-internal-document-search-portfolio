# 第三者の著作物について

本リポジトリには、以下の第三者の著作物が含まれています。
それぞれの利用条件は各ライセンスに従います。

---

## Lucide Icons

画面で使用しているアイコンは [Lucide](https://lucide.dev/) のものです。
ライブラリとして導入せず、SVGのパスデータを
[`src/components/icons/index.tsx`](src/components/icons/index.tsx) へ直接記述しています。

ライセンス原文：https://github.com/lucide-icons/lucide/blob/main/LICENSE

### ISC License

```
Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### MIT License（Feather由来のアイコンに適用）

Lucideの一部は [Feather](https://github.com/feathericons/feather) から派生しており、その部分にはMIT Licenseが適用されます。

```
Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

---

## npmパッケージ

`package.json` に記載している依存パッケージ（Next.js・React・Supabase SDK・pdf-parse など）は、
それぞれのライセンスに従います。パッケージ本体は本リポジトリに含めていません
（`node_modules` はGit管理外）。

各パッケージのライセンスは、インストール後に次のコマンドで確認できます。

```bash
npx license-checker --summary
```
