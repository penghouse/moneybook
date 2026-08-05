import { NextResponse } from "next/server";
import { UTF8_BOM, toCsvText } from "@/lib/csv";

/**
 * Exports stream row batches instead of building one big string. A
 * decade-plus of a daily ledger is several megabytes, and a buffered
 * response would both hold it all in memory and run into the 4.5MB
 * response cap that serverless platforms (Vercel) apply to non-streamed
 * function responses.
 */
export function csvStreamResponse<T>(params: {
  filename: string;
  columns: readonly string[];
  rows: readonly T[];
  toCells: (row: T) => readonly string[];
  batchSize?: number;
}): NextResponse {
  const { filename, columns, rows, toCells, batchSize = 500 } = params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(UTF8_BOM + toCsvText([[...columns]])));
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize).map((r) => [...toCells(r)]);
        controller.enqueue(encoder.encode(toCsvText(chunk)));
      }
      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function unauthorizedJson(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
