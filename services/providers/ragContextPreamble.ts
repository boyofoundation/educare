export const buildRagPreamble = (ragContext?: string): string | null => {
  if (!ragContext) {
    return null;
  }

  return `Use the information inside <context> as the sole knowledge base for this question. When a statement is supported by one of the numbered sources, cite it inline with the matching [n] marker at the end of the relevant sentence or clause. Do not invent source numbers and do not cite any source that was not provided. If the context does not contain the answer, say that you do not have relevant information from the provided knowledge base. <context> ${ragContext} </context>`;
};
