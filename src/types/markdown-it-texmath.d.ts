declare module "markdown-it-texmath" {
  import type MarkdownIt from "markdown-it";

  type TexmathEngine = {
    renderToString: (value: string, options?: Record<string, unknown>) => string;
  };

  type TexmathOptions = {
    engine: TexmathEngine;
    delimiters?: string;
    katexOptions?: Record<string, unknown>;
  };

  const texmath: (md: MarkdownIt, options?: TexmathOptions) => void;

  export default texmath;
}