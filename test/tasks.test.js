import test from "node:test";
import assert from "node:assert/strict";
import dayjs from "dayjs";
import { extractTaskInfo, parseDeadline } from "../src/handlers/tasks.js";

test("extracts task fields", () => {
  assert.deepEqual(extractTaskInfo("tugas matematika besok", dayjs("2026-07-21")), {
    type: "tugas", subject: "matematika", deadline: "2026-07-22",
  });
});

test("parses the next named weekday", () => {
  assert.equal(parseDeadline("deadline senin", dayjs("2026-07-21")), "2026-07-27");
});
