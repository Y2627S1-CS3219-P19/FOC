import { Document } from '@langchain/core/documents';

/** One document per `## heading`; `# ` titles are not chunks. */
export function chunkMarkdown(source: string, markdown: string): Document[] {
  const docs: Document[] = [];
  let heading: string | null = null;
  let body: string[] = [];

  const flush = () => {
    if (heading && body.length) {
      docs.push(new Document({ pageContent: body.join('\n').trim(), metadata: { source, heading } }));
    }
    body = [];
  };

  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      flush();
      heading = line.slice(3).trim();
    } else if (line.startsWith('# ')) {
      flush();
      heading = null; // document title, not a chunk
    } else {
      body.push(line);
    }
  }
  flush();
  return docs.filter((d) => d.pageContent.length > 0);
}

/** Deterministic chunk id component: stable across runs, filesystem-safe. */
export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
