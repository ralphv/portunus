// Test helper: a fetch() stand-in that emulates the slice of the Drive v3 REST
// API GoogleDriveStoreProvider uses, backed by an in-memory file map.

import {
  DRIVE_API_BASE,
  DRIVE_FOLDER_MIME,
  DRIVE_UPLOAD_BASE,
} from "@/constants";

type FakeFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  parents: string[];
  contents: string;
};

export function createFakeDrive(token: string) {
  const files = new Map<string, FakeFile>();
  let seq = 0;
  let lastTime = 0;
  const now = () => {
    lastTime = Math.max(Date.now(), lastTime + 1);
    return new Date(lastTime).toISOString();
  };
  const notFound = () => new Response("File not found", { status: 404 });

  function add(name: string, mimeType: string, parents: string[], contents = "") {
    const f: FakeFile = {
      id: `fake-${++seq}`,
      name,
      mimeType,
      modifiedTime: now(),
      parents,
      contents,
    };
    files.set(f.id, f);
    return f;
  }

  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    if (headers.Authorization !== `Bearer ${token}`) {
      return new Response("unauthorized", { status: 401 });
    }
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const upload = url.href.startsWith(DRIVE_UPLOAD_BASE);
    const base = upload ? DRIVE_UPLOAD_BASE : DRIVE_API_BASE;
    const path = url.href.slice(base.length).split("?")[0];
    const fileId = path.startsWith("/files/")
      ? decodeURIComponent(path.slice("/files/".length))
      : null;

    if (fileId === null) {
      if (method === "GET") {
        const q = url.searchParams.get("q") ?? "";
        const name = /name='([^']+)'/.exec(q)?.[1];
        const wantFolder = q.includes(`mimeType='${DRIVE_FOLDER_MIME}'`);
        const matches = [...files.values()]
          .filter(
            (f) =>
              f.name === name && (f.mimeType === DRIVE_FOLDER_MIME) === wantFolder,
          )
          .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))
          .map((f) => ({ id: f.id, modifiedTime: f.modifiedTime, parents: f.parents }));
        return Response.json({ files: matches });
      }
      if (method === "POST" && !upload) {
        const meta = JSON.parse(String(init.body)) as { name: string; mimeType: string };
        return Response.json({ id: add(meta.name, meta.mimeType, []).id });
      }
      if (method === "POST" && url.searchParams.get("uploadType") === "multipart") {
        const boundary = /boundary=(.+)$/.exec(headers["Content-Type"])![1];
        const parts = String(init.body)
          .split(`--${boundary}`)
          .slice(1, -1)
          .map((p) => p.slice(p.indexOf("\r\n\r\n") + 4, -2));
        const meta = JSON.parse(parts[0]) as { name: string; parents?: string[] };
        const f = add(meta.name, "application/json", meta.parents ?? [], parts[1]);
        return Response.json({ id: f.id, modifiedTime: f.modifiedTime });
      }
    } else {
      const f = files.get(fileId);
      if (!f) return notFound();
      if (method === "GET" && url.searchParams.get("alt") === "media") {
        return new Response(f.contents);
      }
      if (method === "GET") {
        return Response.json({ id: f.id, modifiedTime: f.modifiedTime });
      }
      if (method === "PATCH" && upload) {
        f.contents = String(init.body);
        f.modifiedTime = now();
        return Response.json({ id: f.id, modifiedTime: f.modifiedTime });
      }
      if (method === "PATCH") {
        const remove = (url.searchParams.get("removeParents") ?? "")
          .split(",")
          .filter(Boolean);
        f.parents = f.parents.filter((p) => !remove.includes(p));
        const addParent = url.searchParams.get("addParents");
        if (addParent && !f.parents.includes(addParent)) f.parents.push(addParent);
        return Response.json({ id: f.id });
      }
    }
    return new Response(`unhandled ${method} ${url.href}`, { status: 400 });
  };
}
