import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

/** The browse-list shape for GET /v1/faq/entries. */
export interface FaqEntry {
  source: string;
  heading: string;
  content: string;
}

/** The knowledge base as chunked entries — the same chunking the ingest script uses. */
export function loadCorpusEntries(corpusDir: string): FaqEntry[] {
  const files = readdirSync(corpusDir).filter((f) => f.endsWith('.md'));
  return files.flatMap((file) =>
    chunkMarkdown(file, readFileSync(join(corpusDir, file), 'utf8')).map((d) => ({
      source: d.metadata.source,
      heading: d.metadata.heading as string,
      content: d.pageContent,
    })),
  );
}

/** Deterministic chunk id component: stable across runs, filesystem-safe. */
export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
