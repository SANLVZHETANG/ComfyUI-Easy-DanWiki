# ComfyUI-Easy-DanWiki

<img width="865" height="447" alt="111" src="https://github.com/user-attachments/assets/6069f0b3-8e97-412e-abcb-27aba0b4c582" />

> 还在面对琳琅满目的 TAG 候选列表，不知道该选哪个？
>
> **ComfyUI-Easy-DanWiki** 在 [ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts) 的 TAG 自动补全功能基础上，加入了 **Danbooru Wiki 卡片**，让你可以在选择 TAG 的同时快速查看词条释义、相关信息和示例图片。

## ✨ 功能

### TAG 自动补全 + Wiki 卡片

输入 TAG 时自动显示候选词条，并可直接打开对应的 Wiki 卡片。

* TAG 自动补全
* Wiki 卡片跳转
* 快速添加词条
* Wiki 正文匹配
* Wiki 图片查看
* 支持查看大图（需要下载 Wiki 图片包）

<img width="1178" height="447" alt="6" src="https://github.com/user-attachments/assets/2c06f8a3-52c6-4703-aaaa-dc6a1b00cff8" />

### 🔍 拼音搜索与别名匹配

支持中文拼音搜索，也可以通过 TAG 的别名快速找到对应词条。

<img width="1090" height="507" alt="show" src="https://github.com/user-attachments/assets/cab9ab02-8378-41d6-a233-2d8b4712f764" />

### 🎨 自定义主题与设置

提供主题和显示相关设置，可以根据自己的使用习惯进行调整。

<img width="931" height="522" alt="setting" src="https://github.com/user-attachments/assets/f1e144d4-e5b7-413c-a4a4-6b2330dbbb99" />

### 🧩 其他小功能

* `[` / `]` 快速选择候选 TAG
* 自定义字体
* 中英文 Wiki 切换
* 按图片数量过滤 TAG

---

## 📦 安装

### 方法一：Git

进入 ComfyUI 的 `custom_nodes` 目录：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/SANLVZHETANG/ComfyUI-Easy-DanWiki
```

然后重启 ComfyUI。

### 方法二：下载 ZIP

1. 点击本页面右上角的 **Code → Download ZIP**
2. 解压得到 `ComfyUI-Easy-DanWiki-main` 文件夹
3. 将文件夹重命名为 `ComfyUI-Easy-DanWiki`
4. 将整个文件夹放入：

```text
ComfyUI/custom_nodes/
```

5. 重启 ComfyUI

---

## 🗃️ 数据

TAG 与 Wiki 数据来源于 **Danbooru 快照**，快照时间：

**2026-08-15**

当前数据规模：

| 数据         |     数量 |
| ---------- | -----: |
| TAG（≥50 帖） | 30,442 |
| 中文 Wiki 释义 | 26,487 |
| Wiki 内链    | 24,543 |
| 带图片 TAG    |  9,756 |

> Wiki 图片为独立数据包，需要在release中额外下载后才能使用图片功能。

---

## 🙏 致谢

本项目的自动补全功能基于：

* [ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts)
  感谢 **pythongosssss** 提供了非常扎实的自动补全代码基础，本项目大量功能建立在此之上。

* [Maple Font](https://github.com/subframe7536/maple-font)
  提供字体支持。

* [emacsmirror/glass-tty-theme](https://github.com/emacsmirror/glass-tty-theme)
  提供字体支持。

---

## 📄 License

MIT
