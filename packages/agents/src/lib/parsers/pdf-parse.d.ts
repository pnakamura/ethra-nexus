declare module 'pdf-parse/lib/pdf-parse.js' {
  function pdfParse(
    data: Buffer | Uint8Array,
    options?: {
      pagerender?: (
        pageData: { getTextContent(): Promise<{ items: Array<{ str: string }> }> }
      ) => Promise<string>
      [key: string]: unknown
    }
  ): Promise<{ text: string; numpages: number; [key: string]: unknown }>
  export default pdfParse
}

declare module 'pdf-parse' {
  function pdfParse(
    data: Buffer | Uint8Array,
    options?: {
      pagerender?: (
        pageData: { getTextContent(): Promise<{ items: Array<{ str: string }> }> }
      ) => Promise<string>
      [key: string]: unknown
    }
  ): Promise<{ text: string; numpages: number; [key: string]: unknown }>
  export default pdfParse
}
