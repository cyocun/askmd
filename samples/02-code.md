---
title: コードブロック & シンタックスハイライト
date: 2025-01-15
tags: [sample, code]
---

# コードブロック

## TypeScript

```typescript
interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  title?: string | null;
  children: TreeNode[] | null;
}

function flatten(node: TreeNode): TreeNode[] {
  if (!node.is_dir) return [node];
  return (node.children ?? []).flatMap(flatten);
}
```

## Rust

```rust
#[tauri::command]
pub async fn search_markdown(root: String, query: String) -> Result<Vec<SearchHit>, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(vec![]);
    }
    Ok(vec![])
}
```

## Python

```python
def fibonacci(n: int) -> list[int]:
    """Generate Fibonacci sequence up to n terms."""
    seq = [0, 1]
    for _ in range(2, n):
        seq.append(seq[-1] + seq[-2])
    return seq[:n]
```

## JSON

```json
{
  "productName": "askmd",
  "version": "0.1.0",
  "identifier": "com.cyocun.askmd"
}
```

## Bash

```bash
#!/bin/bash
# askmd をソースからビルド
npm ci
npm run build:frontend
cd src-tauri && cargo build --release
```

## Diff

```diff
- old line removed
+ new line added
  unchanged context line
- another removal
+ another addition
```

## インラインコード

`createEl('div', { class: 'md-body' })` のように DOM ヘルパーを使う。
