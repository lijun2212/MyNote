# Markdown 内嵌 HTML 支持说明 {#markdown-embedded-html-support}

## 修订记录 {#revision-history}

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 0.1 | 2026-06-18 | 首版文档，说明 MyNote 对 Markdown 内嵌 HTML 的有限支持范围、属性限制、安全规则和示例用法。 |

## 目录 {#table-of-contents}

1. [支持原则](#support-principles)
2. [支持的 HTML 标签总表](#supported-tags)
3. [基础排版类标签](#basic-formatting-tags)
4. [文本容器标签](#text-container-tags)
5. [折叠内容标签](#details-tags)
6. [图片标签](#image-tag)
7. [属性限制](#attribute-limits)
8. [禁止的标签和写法](#forbidden-tags-and-patterns)
9. [与 Markdown 语法的关系](#markdown-interaction)
10. [常见示例](#examples)

## 1. 支持原则 {#support-principles}

MyNote 支持在 Markdown 正文中写少量内嵌 HTML，用来补足标准 Markdown 不方便表达的轻量排版能力。

参考 Markdown 基础语法中对“内嵌 HTML 标签”的说明：行级 HTML 可以混在段落里使用；块级 HTML 通常需要与前后内容用空行分隔；块级 HTML 内部一般不再继续解析 Markdown 语法。

MyNote 采用的是**有限白名单**策略：只允许本文档列出的标签，其它原生 HTML 标签会被移除。这样可以兼顾常用排版能力和预览区安全性。

## 2. 支持的 HTML 标签总表 {#supported-tags}

MyNote 允许用户在 Markdown 原文中直接写下面这些 HTML 标签：

| 分类 | 标签 | 主要用途 |
| --- | --- | --- |
| 基础排版 | `<br>` | 手动换行。 |
| 基础排版 | `<hr>` | 分隔线。 |
| 基础排版 | `<sub>` | 下标，例如化学式。 |
| 基础排版 | `<sup>` | 上标，例如指数、脚注标记。 |
| 基础排版 | `<kbd>` | 键盘按键。 |
| 基础排版 | `<mark>` | 高亮标记。 |
| 基础排版 | `<abbr>` | 缩写说明。 |
| 文本容器 | `<span>` | 行内文本容器。 |
| 文本容器 | `<p>` | HTML 段落。 |
| 折叠内容 | `<details>` | 可展开/收起区域。 |
| 折叠内容 | `<summary>` | 折叠区域标题。 |
| 图片 | `<img>` | 插入图片。 |

大小写不敏感。MyNote 会把允许的原生 HTML 标签规范化为小写标签。

## 3. 基础排版类标签 {#basic-formatting-tags}

### `<br>` 手动换行

适合在同一段内强制换行。

```md
第一行<br>第二行
```

### `<hr>` 分隔线

适合插入一条 HTML 分隔线。

```md
上一部分

<hr>

下一部分
```

如果只是普通分隔线，也可以继续使用 Markdown 原生写法：

```md
---
```

### `<sub>` 下标

适合化学式、变量下标等场景。

```md
水的化学式是 H<sub>2</sub>O。
```

### `<sup>` 上标

适合指数、单位、脚注标记等场景。

```md
质能方程可以写成 E = mc<sup>2</sup>。
```

### `<kbd>` 键盘按键

适合说明快捷键。

```md
按 <kbd>Cmd</kbd> + <kbd>K</kbd> 打开搜索。
```

### `<mark>` 高亮文本

适合标记重点内容。

```md
这里是 <mark>需要重点回看</mark> 的结论。
```

### `<abbr>` 缩写说明

`<abbr>` 只保留 `title` 属性。

```md
<abbr title="Application Programming Interface">API</abbr> 是应用程序接口。
```

## 4. 文本容器标签 {#text-container-tags}

### `<span>` 行内容器

`<span>` 适合做少量行内包裹。当前只保留 `title` 属性，不支持 `style`、`class`、事件属性等。

```md
这是 <span title="补充说明">一段带提示的文字</span>。
```

下面这种写法会保留文字和 `<span>`，但会删除 `style`：

```md
<span style="color:red">红色文字</span>
```

MyNote 当前不会把它渲染成红色。

### `<p>` HTML 段落

`<p>` 适合在确实需要 HTML 段落时使用。当前只保留 `title` 属性。

```md
<p title="段落说明">这是一个 HTML 段落。</p>
```

建议在 `<p>` 前后留空行，避免和相邻 Markdown 段落混在一起。

## 5. 折叠内容标签 {#details-tags}

`<details>` 和 `<summary>` 可以配合使用，创建可展开/收起的内容块。

```md
<details>
<summary>展开查看背景说明</summary>

这里是补充说明。

</details>
```

如果希望默认展开，可以在 `<details>` 上写 `open`：

```md
<details open>
<summary>默认展开</summary>

这段内容打开笔记时会默认显示。

</details>
```

`<details>` 只保留 `open` 属性。`<summary>` 不保留额外属性。

## 6. 图片标签 {#image-tag}

MyNote 支持有限的原生 `<img>`。推荐优先使用 Markdown 图片语法：

```md
![说明文字](../assets/example.png)
```

当你需要写 HTML 图片标签时，可以使用：

```md
<img src="notes/assets/demo.png" alt="示例图" title="Demo">
```

`<img>` 只保留下面三个属性：

1. `src`
2. `alt`
3. `title`

`src` 只允许下面这些来源：

| 来源 | 示例 |
| --- | --- |
| `http://` 或 `https://` 远程图片 | `<img src="https://example.com/a.png" alt="远程图">` |
| `notes/...` 知识库内路径 | `<img src="notes/assets/a.png" alt="本地图">` |
| `assets/...` 知识库资源路径 | `<img src="assets/a.png" alt="资源图">` |
| `/...` 根路径 | `<img src="/assets/a.png" alt="根路径图">` |
| 图片 `data:` URL | `<img src="data:image/png;base64,..." alt="内嵌图">` |

其它 `src` 会被删除。例如：

```md
<img src="x" onerror="alert(1)">
```

预览时会移除 `src` 和 `onerror`，不会加载这个地址，也不会执行脚本。

## 7. 属性限制 {#attribute-limits}

MyNote 对原生 HTML 属性做严格白名单处理：

| 标签 | 保留属性 | 说明 |
| --- | --- | --- |
| `<abbr>` | `title` | 用于展示缩写解释。 |
| `<details>` | `open` | 用于默认展开。 |
| `<img>` | `src`, `alt`, `title` | `src` 还必须满足安全来源限制。 |
| `<p>` | `title` | 用于补充提示。 |
| `<span>` | `title` | 用于补充提示。 |
| `<br>` | 无 | 所有属性都会被移除。 |
| `<hr>` | 无 | 所有属性都会被移除。 |
| `<kbd>` | 无 | 所有属性都会被移除。 |
| `<mark>` | 无 | 所有属性都会被移除。 |
| `<sub>` | 无 | 所有属性都会被移除。 |
| `<summary>` | 无 | 所有属性都会被移除。 |
| `<sup>` | 无 | 所有属性都会被移除。 |

下面这些属性一律不支持：

1. `style`
2. `class`
3. `id`
4. `onclick`、`onerror` 等所有 `on*` 事件属性
5. 未在上表列出的其它属性

## 8. 禁止的标签和写法 {#forbidden-tags-and-patterns}

除支持表中列出的标签外，其它原生 HTML 标签都禁止。常见禁止项包括：

| 禁止标签 | 原因或替代方案 |
| --- | --- |
| `<script>` | 禁止执行脚本。 |
| `<iframe>` | 禁止嵌入外部页面。 |
| `<object>`、`<embed>` | 禁止插件式嵌入。 |
| `<video>`、`<audio>` | 当前不支持原生媒体嵌入。 |
| `<table>`、`<thead>`、`<tbody>`、`<tr>`、`<th>`、`<td>` | 原生 HTML 表格不支持；请使用 Markdown 表格。 |
| `<ul>`、`<ol>`、`<li>` | 原生 HTML 列表不支持；请使用 Markdown 列表。 |
| `<div>` | 当前不支持；轻量行内容器请用 `<span>`，段落请用 `<p>`。 |
| `<style>` | 禁止内嵌样式。 |
| `<link>`、`<meta>` | 禁止改写页面资源或元信息。 |

被禁止的成对标签及其内部内容会一起移除。例如：

```md
<table><tr><td>Raw table</td></tr></table>
```

预览中不会显示这个原生 HTML 表格，也不会显示 `Raw table`。如果希望保留内容，请改写为 Markdown 表格：

```md
| A | B |
| --- | --- |
| 1 | 2 |
```

## 9. 与 Markdown 语法的关系 {#markdown-interaction}

### 代码块中的 HTML 不会被解析

围栏代码块里的 HTML 会作为代码显示，不会当作 HTML 渲染。

````md
```html
<span>这里显示为代码</span>
```
````

### 行内 HTML 可以混在普通段落里

```md
这是普通正文，里面有 H<sub>2</sub>O 和 <mark>重点</mark>。
```

### 块级 HTML 建议前后留空行

例如 `<p>`、`<details>` 这种块级写法，建议和前后 Markdown 内容之间保留空行：

```md
前一段。

<details>
<summary>展开</summary>
补充内容。
</details>

后一段。
```

### HTML 块内部不要依赖复杂 Markdown 解析

为了保持行为稳定，不建议在 HTML 块内部写复杂 Markdown。需要标题、列表、表格、代码块时，优先使用 Markdown 原生语法。

## 10. 常见示例 {#examples}

### 快捷键说明

```md
使用 <kbd>Cmd</kbd> + <kbd>K</kbd> 打开搜索。
```

### 数学或化学文本

```md
水是 H<sub>2</sub>O，平方可以写成 x<sup>2</sup>。
```

### 高亮重点

```md
这个结论需要 <mark>下次回看时优先确认</mark>。
```

### 缩写说明

```md
<abbr title="Large Language Model">LLM</abbr> 可以辅助整理笔记。
```

### 折叠补充说明

```md
<details>
<summary>为什么这样设计？</summary>

这里放不影响主线阅读的补充解释。

</details>
```

### HTML 图片

```md
<img src="assets/diagram.png" alt="流程图" title="流程图示例">
```

更常见的情况下，建议仍然使用 Markdown 图片语法：

```md
![流程图](assets/diagram.png)
```
