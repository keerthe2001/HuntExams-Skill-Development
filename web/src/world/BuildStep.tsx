// The Build step: the worked example (run it, watch each line) and the exercise, as tap-to-build
// blocks on phones or the code editor on bigger screens.
import { useState } from "react";

import { ExampleCode, Exercise } from "@/code/CodeSection";
import type { Topic } from "@/lib/types";

import { BlockBuilder, canBlockBuild } from "./BlockBuilder";

export function BuildStep({ t, phone }: { t: Topic; phone: boolean }) {
  const [useEditor, setUseEditor] = useState(false);
  const b = t.body;
  const blocks = phone && !useEditor && b.exercise && canBlockBuild(b.exercise);
  return (
    <>
      {b.code && <ExampleCode code={b.code} mode="simple" />}
      {b.exercise && (
        <div className="w-build-ex">
          {blocks ? <BlockBuilder topic={t.slug} ex={b.exercise} /> : <Exercise key={t.slug} topic={t.slug} ex={b.exercise} />}
          {phone && canBlockBuild(b.exercise) && (
            <button type="button" className="w-link" onClick={() => setUseEditor((u) => !u)}>{useEditor ? "Build with blocks instead" : "Type it in the editor instead"}</button>
          )}
        </div>
      )}
    </>
  );
}
