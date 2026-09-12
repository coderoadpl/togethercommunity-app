# Content authoring

The shared Markdown editor provides a visual editing surface and a raw Markdown source tab. Both views edit one canonical Markdown string, so switching tabs does not create a second format or lose content.

The visual toolbar supports bold and italic text, heading levels two and three, bulleted and numbered lists, block quotes, inline code, fenced code blocks, safe links, and undo and redo. Links accept `https` and `mailto` destinations, and images already present in Markdown are kept only when they use HTTPS. Pasted HTML is converted to the supported Markdown model, and pasting a URL onto selected text creates a link.

Emphasis is written as `_text_`, horizontal rules, strike-through and image references are preserved, and content the visual surface cannot represent — Markdown tables, task lists and raw HTML — keeps editing on the Markdown tab so nothing is dropped.

Campaigns store the canonical source in `bodySource`, which is the only field the editor produces. The campaign form still renders and sanitises `bodyHtml` in the browser with the shared Markdown pipeline and posts both fields, exactly as the previous text area did; the same pipeline runs on the server for delivery and preview. A campaign whose body was authored as raw HTML stays in the raw HTML mode of the campaign form. Legal document bodies use the same editor and remain Markdown source; the hosted legal renderer supports headings one to three, nested lists of both kinds, single- and multi-paragraph quotes, code, links, HTTPS images, horizontal rules, `**strong**`, `_emphasis_`, `~~strike-through~~`, backslash escapes and HTML entities.

Lesson HTML content, image uploads, table authoring, collaborative editing, and community posts that are currently stored as plain text are outside this editor's scope.
