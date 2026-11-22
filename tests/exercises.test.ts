import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  catalogueDataVersion,
  exerciseCatalogue,
  exerciseSchema,
  exerciseTranslations,
  localizeExercise,
  matchesExercise,
  type Exercise,
} from "@ironlog/shared";
import { serverCatalogue } from "../packages/server/src/catalogue.js";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";

const imported = exerciseSchema
  .array()
  .parse(
    JSON.parse(readFileSync("packages/server/data/exercises.json", "utf8")),
  );

test("导入覆盖上游全部动作并保留编号，单独分类器具和有氧", () => {
  assert.equal(imported.length, 1324);
  assert.equal(new Set(imported.map((exercise) => exercise.id)).size, imported.length);
  for (const exercise of imported) {
    assert.equal(exercise.id, `exdb_${exercise.source?.id}`);
    assert.ok(exercise.instructions.length > 0);
  }
  assert.ok(imported.some((exercise) => exercise.equipment === "band"));
  assert.ok(imported.some((exercise) => exercise.equipment === "kettlebell"));
  const cardio = imported.filter((exercise) => exercise.muscle === "cardio");
  assert.equal(cardio.length, 29);
  assert.ok(cardio.every((exercise) => exercise.mode === "timed"));
});

test("新版目录补齐独立动作的中文名称、类型和教学，并保留旧动作记录方式", () => {
  const current = new Map(serverCatalogue.map((exercise) => [exercise.id, exercise]));
  assert.equal(serverCatalogue.length, 5650);
  assert.equal(current.size, serverCatalogue.length);
  assert.ok(serverCatalogue.every((exercise) => /\p{Script=Han}/u.test(exercise.name) && exercise.instructions.length));
  const originalsByName = new Map(exerciseCatalogue.map((exercise) => [
    exercise.englishName.toLowerCase(), exercise,
  ]));
  for (const previous of imported) {
    const visible = originalsByName.get(previous.englishName.toLowerCase()) ?? previous;
    const exercise = current.get(visible.id);
    assert.ok(exercise, visible.id);
    for (const key of ["mode", "equipment", "muscle", "volumeMultiplier"] as const)
      assert.equal(exercise[key], visible[key], `${visible.id} ${key}`);
  }
  assert.ok(serverCatalogue.some((exercise) => exercise.category === "yoga"));
  assert.ok(serverCatalogue.some((exercise) => exercise.equipment === "suspension"));
  assert.ok(serverCatalogue.some((exercise) => exercise.equipment === "landmine"));
  const described = serverCatalogue.filter((exercise) => Boolean(exercise.description));
  assert.ok(described.length >= 5632);
  const provenance = JSON.parse(readFileSync("packages/server/data/opengym-source.json", "utf8")) as {
    revision: string;
    sources: string[];
    describedCount: number;
  };
  assert.deepEqual(provenance.sources, ["catalogue/exercises/", "catalogue/i18n/zh.json"]);
  assert.equal(provenance.describedCount, 5632);
  assert.equal(catalogueDataVersion, `${provenance.revision}:2`);
  assert.ok(/\p{Script=Han}/u.test(current.get("bench-press")?.description ?? ""));
  assert.ok(/\p{Script=Han}/u.test(current.get("exdb_1760")?.description ?? ""));
});

test("中文名称规则逐项匹配固定动作ID和英文名，保留原始数据、教学及来源", () => {
  assert.equal(Object.keys(exerciseTranslations).length, 90);
  for (const [id, [englishName, name]] of Object.entries(
    exerciseTranslations,
  )) {
    const original = imported.find((exercise) => exercise.id === id)!;
    assert.ok(original, id);
    assert.equal(original.englishName, englishName);
    const translated = localizeExercise(original);
    assert.equal(exerciseSchema.safeParse(translated).success, true);
    assert.equal(translated.name, name);
    assert.equal(translated.id, original.id);
    assert.equal(translated.englishName, original.englishName);
    assert.deepEqual(translated.instructions, original.instructions);
    assert.deepEqual(translated.source, original.source);
    assert.deepEqual(localizeExercise(translated), translated);
    assert.equal(original.name, englishName);
  }
});

test("中文命名只应用于对应来源和版本内容，自定义名称和其他变式保持作者内容", () => {
  const original = imported.find((exercise) => exercise.id === "exdb_1760")!;
  const custom = { ...original, name: "我自己的动作", custom: true };
  assert.equal(localizeExercise(custom), custom);
  const otherSource = {
    ...original,
    source: { ...original.source!, repository: "another/repository" },
  };
  assert.equal(localizeExercise(otherSource), otherSource);
  const renamed = { ...original, englishName: "different movement" };
  assert.equal(localizeExercise(renamed), renamed);
  const exercise = localizeExercise(original);
  assert.equal(matchesExercise(exercise, "酒杯 深蹲"), true);
  assert.equal(matchesExercise(exercise, "DUMBBELL goblet squat"), true);
  assert.equal(matchesExercise(exercise, "barbell goblet squat"), false);
  const pushup = serverCatalogue.find((exercise) => exercise.id === "push-up")!;
  assert.equal(matchesExercise(pushup, "Push Up"), true);
  assert.equal(matchesExercise(pushup, "pushup"), true);
});

test("动作API支持中文多关键词与别名，AI训练解析使用同一中文目录及原动作ID", async () => {
  const db = openDatabase(":memory:");
  let prompt: { exercises: Exercise[] } | undefined;
  const fake: typeof fetch = async (_url, options) => {
    const payload = JSON.parse(String(options?.body));
    prompt = JSON.parse(payload.messages[1].content);
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "高脚杯深蹲",
              exercises: [
                {
                  id: "row",
                  exerciseId: "exdb_1760",
                  restSeconds: 90,
                  sets: [
                    {
                      id: "set",
                      type: "normal",
                      weight: 20,
                      reps: 8,
                      completed: true,
                    },
                  ],
                },
              ],
            }),
          },
        },
      ],
    });
  };
  const { app, auth } = createApp(
    db,
    {
      ai: {
        baseUrl: "https://model.example/v1",
        model: "test",
        apiKey: "test",
      },
    },
    fake,
  );
  const user = auth.login("exercise-translation");
  const headers = {
    Authorization: `Bearer ${user.token}`,
    "Content-Type": "application/json",
  };
  try {
    const builtIn = await app.request("/api/exercises?builtin=1", { headers });
    assert.equal(builtIn.status, 200);
    const directory = (await builtIn.json()) as { version: string; exercises: Exercise[] };
    assert.equal(directory.version, catalogueDataVersion);
    assert.equal(directory.exercises.length, 5650);
    assert.equal(directory.exercises.find((exercise) => exercise.id === "exdb_2612")?.mode, "timed");
    const response = await app.request(
      `/api/exercises?q=${encodeURIComponent("哑铃 卧推")}&muscle=chest&equipment=dumbbell`,
      { headers },
    );
    assert.equal(response.status, 200);
    const matches = (await response.json()) as Exercise[];
    assert.ok(
      matches.some(
        (exercise) =>
          exercise.id === "exdb_0289" && exercise.name === "平板哑铃卧推",
      ),
    );
    const alias = await app.request(
      `/api/exercises?q=${encodeURIComponent("酒杯 深蹲")}`,
      { headers },
    );
    assert.equal(((await alias.json()) as Exercise[])[0]?.id, "exdb_1760");
    const yoga = await app.request("/api/exercises?category=yoga&limit=10", { headers });
    const yogaExercises = (await yoga.json()) as Exercise[];
    assert.equal(yogaExercises.length, 10);
    assert.ok(yogaExercises.every((exercise) => exercise.category === "yoga"));
    const parsed = await app.request("/api/ai/parse-workout", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "高脚杯深蹲20kg做8次", date: "2026-11-14" }),
    });
    assert.equal(parsed.status, 200);
    const target = prompt!.exercises.find(
      (exercise) => exercise.id === "exdb_1760",
    );
    assert.equal(target?.name, "哑铃高脚杯深蹲");
    const result = (await parsed.json()) as {
      workout: { exercises: { snapshot: { name: string } }[] };
    };
    assert.equal(result.workout.exercises[0]?.snapshot.name, "哑铃高脚杯深蹲");
  } finally {
    db.close();
  }
});
