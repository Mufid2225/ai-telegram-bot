export const tools = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "Get current date and time (useful for deadlines, reminders, scheduling)",
      parameters: {
        type: "object",
        properties: {
          format: {
            type: "string",
            enum: ["full", "date", "time", "day"],
            description: "Format output",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web for current information, news, or facts",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_task",
      description: "Save a task, assignment, exam, or important note to database",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["tugas", "ujian", "catatan"],
            description: "Type of item",
          },
          subject: { type: "string", description: "Subject/mata pelajaran" },
          deadline: {
            type: "string",
            description: "Deadline date (YYYY-MM-DD)",
          },
          content: { type: "string", description: "Description of the task" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "Perform mathematical calculations",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Math expression (e.g., '2 + 2 * 3')",
          },
        },
        required: ["expression"],
      },
    },
  },
];

function getCurrentTime(format = "full") {
  const now = new Date();
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  const day = days[now.getDay()];
  const date = now.getDate();
  const month = months[now.getMonth()];
  const year = now.getFullYear();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const iso = now.toISOString().split("T")[0];

  switch (format) {
    case "date":
      return `${day}, ${date} ${month} ${year} (${iso})`;
    case "time":
      return `${h}:${m}:${s}`;
    case "day":
      return day;
    default:
      return `${day}, ${date} ${month} ${year} ${h}:${m}:${s}`;
  }
}

async function searchWeb(query) {
  try {
    const resp = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
    );
    const data = await resp.json();
    return (
      data.AbstractText ||
      data.AbstractSource ||
      `Tidak ada hasil untuk "${query}".`
    );
  } catch {
    return `Gagal mencari "${query}".`;
  }
}

async function saveTask(args, { userId, pool }) {
  const type = args.type || "catatan";
  try {
    await pool.query(
      `INSERT INTO memories (user_id, type, subject, deadline, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, type, args.subject || null, args.deadline || null, args.content, new Date().toISOString()]
    );
    return `Berhasil menyimpan ${type}: ${args.content}`;
  } catch (error) {
    return `Gagal menyimpan: ${error.message}`;
  }
}

function calculate(expression) {
  try {
    const sanitized = expression.replace(/[^0-9+\-*/.() ]/g, "");
    const result = Function(`"use strict"; return (${sanitized})`)();
    return `${expression} = ${result}`;
  } catch {
    return `Gagal menghitung: "${expression}"`;
  }
}

export async function executeTool(name, args, context) {
  switch (name) {
    case "get_current_time":
      return getCurrentTime(args.format);
    case "search_web":
      return await searchWeb(args.query);
    case "save_task":
      return await saveTask(args, context);
    case "calculate":
      return calculate(args.expression);
    default:
      return `Unknown tool: ${name}`;
  }
}
