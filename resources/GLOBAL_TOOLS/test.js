// 文件: JXNU_01.js
// 功能：从江西师范大学正方教务系统获取课程表，用 DOM 解析后导入到拾光课程表
// 适配：正方教务系统（当前页面 DOM 解析）
// 维护者：heybuddy

// ---------- 常量配置 ----------

const UNIT_COUNT = 13; // 每天最大节次数

// ---------- 全局验证函数 ----------

function validateYearInput(input) {
    if (/^\d{4}$/.test(input)) return false;
    return "请输入四位数字的年份（例如 2024）";
}

function validateWeeksInput(input) {
    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1 || num > 55) return "请输入 1-55 之间的有效周数";
    return false;
}

// ---------- 单元格文本解析 ----------

/**
 * 从课程格子文本中提取课程名、教师、教室
 * 输入例如："军事理论(W7103)合班吕俊.4班"
 */
function parseCellText(line) {
    line = line.trim();
    if (line.length < 3) return null;

    let room = '', name = '', teacher = '';

    const rmMatch = line.match(/\(([^)]+)\)/);
    if (rmMatch) {
        room = rmMatch[1].trim();
        name = line.substring(0, line.indexOf('(' + rmMatch[1] + ')')).trim();
        const after = line.substring(
            line.indexOf('(' + rmMatch[1] + ')') + rmMatch[1].length + 2
        ).trim();

        const hbMatch = after.match(/合班(.+?)(?:$|\.\d+班|\s)/);
        if (hbMatch) teacher = hbMatch[1].trim();

        if (!teacher) {
            const jgMatch = after.match(/教工(.+?)(?:#|$|\s)/);
            if (jgMatch) teacher = jgMatch[1].trim();
        }

        if (!teacher && after.length > 0 && !after.match(/^\d+班$/)) {
            teacher = after.replace(/\.\d+班$/, '').trim();
        }
    } else {
        name = line;
    }

    name = name.replace(/\s+/g, '');
    if (!/[\u4e00-\u9fa5a-zA-Z]/.test(name)) return null;
    if (name.length > 50) name = name.substring(0, 50);

    return { name, teacher, room };
}

/**
 * 判断单元格文本是否是"节次标签"
 */
function isPeriodLabel(text) {
    const t = text.trim();
    if (!t) return false;

    const cleaned = t.replace(/\s+/g, '');
    if (/^[1-9]$/.test(cleaned)) return true;
    if (/^(1[0-3]?)$/.test(cleaned) && parseInt(cleaned) <= UNIT_COUNT) return true;
    if (/^\d{1,2}[-–,]\d{1,2}$/.test(cleaned)) {
        const parts = cleaned.split(/[-–,]/);
        const s = parseInt(parts[0]);
        const e = parseInt(parts[1]);
        if (s >= 1 && e <= UNIT_COUNT && s <= e) return true;
    }
    if (t.includes('晚') && (t.includes('上') || t.includes('自'))) return true;
    return false;
}

/**
 * 从节次标签文本解析出节次数字数组
 * "1" → [1], "3-4" → [3,4], "晚上" → [11,12,13], "12" → [1,2]
 */
function parsePeriodText(text) {
    const t = text.trim();
    if (t.includes('晚')) return [11, 12, 13];

    const cleaned = t.replace(/\s+/g, '');
    const rangeMatch = cleaned.match(/^(\d{1,2})[-–,]\s*(\d{1,2})$/);
    if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = parseInt(rangeMatch[2]);
        if (start >= 1 && end <= UNIT_COUNT && start <= end) {
            const result = [];
            for (let i = start; i <= end; i++) result.push(i);
            return result;
        }
    }

    const singleMatch = cleaned.match(/^(\d{1,2})$/);
    if (singleMatch) {
        const num = parseInt(singleMatch[1]);
        if (num >= 1 && num <= UNIT_COUNT) return [num];
    }

    const nums = [];
    for (let i = 0; i < cleaned.length; i++) {
        const n = parseInt(cleaned[i]);
        if (n >= 1 && n <= 9 && !nums.includes(n)) nums.push(n);
    }
    if (nums.length > 0) {
        nums.sort((a, b) => a - b);
        return nums;
    }
    return [];
}

// ---------- DOM 解析（当前页面） ----------

/**
 * 在指定 window 对象中递归查找包含"星期一"的课表表格。
 * 支持表格位于 iframe 内的情况。
 */
function findCourseTable(win) {
    try {
        for (const t of win.document.querySelectorAll('table')) {
            if (t.textContent.includes('星期一')) return t;
        }
    } catch (e) {
        // 跨域 iframe 无法访问，跳过
    }
    // 递归查找 iframe
    try {
        for (let i = 0; i < win.frames.length; i++) {
            const found = findCourseTable(win.frames[i]);
            if (found) return found;
        }
    } catch (e) {
        // 跨域 iframe 无法访问，跳过
    }
    return null;
}

/**
 * 从当前页面的 DOM 中，用 table.rows API 提取课程数据。
 *
 * 核心差异（对比旧脚本的 querySelectorAll 平铺方案）：
 *   旧脚本用 gridTable.querySelectorAll('td, th') 获取所有格子的扁平列表，
 *   在有 rowspan 时索引会错位，导致课程落到错误的星期列。
 *
 *   本方案用 table.rows[r].cells[c]——浏览器原生处理 rowspan，
 *   rowspan 覆盖的格在下一行的 cells 中自动消失，不需要手动追踪。
 */
function parseCourseTableFromCurrentPage() {
    const courses = [];
    const dayNames = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

    const table = findCourseTable(window);
    if (!table) {
        console.warn("[JXNU] 未找到课表表格");
        return { courses, html: '' };
    }

    const pageHtml = document.documentElement.outerHTML;
    const rows = table.rows;
    if (rows.length < 3) {
        console.warn("[JXNU] 课表格行数不足:", rows.length);
        return { courses, html: pageHtml };
    }

    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
        const rowText = rows[i].textContent.trim();
        if (dayNames.some(d => rowText.includes(d))) {
            headerRowIdx = i;
            break;
        }
    }
    if (headerRowIdx < 0) {
        console.warn("[JXNU] 未找到课表表头行");
        return { courses, html: pageHtml };
    }

    // 从真实 HTML 得知表格结构是 9 列（非 8 列）：
    //   col 0: 分组标签（"上午"/"下午"，有 rowspan）
    //   col 1: 节次标签（"1\n2"、"3"、"4" ...）
    //   col 2-8: 周一~周日的课程数据
    const headerRow = rows[headerRowIdx];
    const totalCols = headerRow.cells.length;

    // dayColMap: 表头列索引 → 星期几 (1-7)
    // 课程数据从第 2 列开始（col 2 = 星期一）
    const dayColMap = {};
    let dayCounter = 1;
    for (let c = 2; c < totalCols && dayCounter <= 7; c++) {
        dayColMap[c] = dayCounter;
        dayCounter++;
    }

    // rowspan 追踪：rowspanActive[col] > 0 表示第 col 列被上层 rowspan 覆盖
    const rowspanActive = new Array(totalCols).fill(0);

    // 遍历数据行
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        const cells = row.cells;
        if (cells.length < 2) continue;

        // 用列遍历法：按 header 列顺序遍历，跳过 rowspan 覆盖的列，
        // 将 cells[cellIdx] 映射到正确的 header 列
        let periodText = '';
        let periods = [];
        let foundPeriod = false;
        let courseData = []; // [{cell, col, day}, ...]

        let cellIdx = 0;
        for (let col = 0; col < totalCols && cellIdx < cells.length; col++) {
            if (rowspanActive[col] > 0) {
                rowspanActive[col]--;
                continue; // 此列被覆盖，cells 中没有对应的格
            }

            const cell = cells[cellIdx];
            cellIdx++;

            // 记录此单元格的 rowspan
            if (cell.rowSpan > 1) {
                rowspanActive[col] = cell.rowSpan - 1;
            }

            const text = cell.textContent.trim();

            if (col === 1) {
                // 节次标签列
                if (text && isPeriodLabel(text)) {
                    periodText = text;
                    periods = parsePeriodText(text);
                    foundPeriod = periods.length > 0;
                }
            } else if (dayColMap[col]) {
                // 课程列
                if (text && text.length >= 2) {
                    courseData.push({ cell, text, day: dayColMap[col] });
                }
            }
            // col 0 = 分组标签（上午/下午），跳过
        }

        if (!foundPeriod) continue;

        // 处理此行的所有课程数据
        for (const { cell, text, day } of courseData) {
            const cleanText = text.replace(/\s+/g, '');
            if (['上午', '下午', '晚上', '中午', '中 午', '午休', '节次'].some(k => cleanText === k)) continue;

            let name = '', teacher = '', room = '';
            const titleEl = cell.querySelector('.title font, .title');

            if (titleEl) {
                name = titleEl.textContent.trim();
                if (/[\u4e00-\u9fa5a-zA-Z]/.test(name)) {
                    const pEls = cell.querySelectorAll('p font');
                    if (pEls.length >= 2) room = pEls[1].textContent.trim();
                    if (pEls.length >= 3) teacher = pEls[2].textContent.trim();
                    if (!room && pEls.length >= 1) {
                        const t = pEls[0].textContent.trim();
                        if (/[楼馆教栋区斋轩堂室]/.test(t)) room = t;
                    }
                } else {
                    name = '';
                }
            }

            if (!name) {
                const parsed = parseCellText(text);
                if (!parsed || !parsed.name) continue;
                name = parsed.name;
                teacher = parsed.teacher || teacher;
                room = parsed.room || room;
            }

            name = name.replace(/\s+/g, '');
            if (!/[\u4e00-\u9fa5a-zA-Z]/.test(name)) continue;

            courses.push({
                name, teacher: teacher || '', position: room || '',
                day, startSection: periods[0],
                endSection: periods[periods.length - 1], weeks: [],
            });
        }
    }

    // 去重
    const seen = new Set();
    const deduped = [];
    for (const c of courses) {
        const key = `${c.name}|${c.day}|${c.startSection}|${c.endSection}|${c.teacher}|${c.position}`;
        if (!seen.has(key)) { seen.add(key); deduped.push(c); }
    }

    console.log(`[JXNU] 解析完成，原始=${courses.length}，去重后=${deduped.length} 条课程`);
    return { courses: deduped, html: pageHtml };
}

// ---------- 时间段配置 ----------

function getTimeSlots() {
    return [
        { number: 1, startTime: "08:00", endTime: "08:45" },
        { number: 2, startTime: "08:50", endTime: "09:35" },
        { number: 3, startTime: "09:50", endTime: "10:35" },
        { number: 4, startTime: "10:40", endTime: "11:25" },
        { number: 5, startTime: "11:30", endTime: "12:15" },
        { number: 6, startTime: "14:00", endTime: "14:45" },
        { number: 7, startTime: "14:50", endTime: "15:35" },
        { number: 8, startTime: "15:50", endTime: "16:35" },
        { number: 9, startTime: "16:40", endTime: "17:25" },
        { number: 10, startTime: "18:30", endTime: "19:15" },
        { number: 11, startTime: "19:20", endTime: "20:05" },
        { number: 12, startTime: "20:10", endTime: "20:55" },
        { number: 13, startTime: "21:00", endTime: "21:45" },
    ];
}

// ---------- 用户交互 ----------

async function promptUserToStart() {
    return await window.AndroidBridgePromise.showAlert(
        "江西师范大学 课表导入",
        "请确认：\n1. 已在浏览器中登录教务系统\n2. 已进入学生课表查询页面并选择了正确的学年学期\n3. 已点击【查询】按钮，课表已正常显示\n\n点击确定开始导入。",
        "确定，开始导入"
    );
}

async function getTotalWeeks() {
    return await window.AndroidBridgePromise.showPrompt(
        "设置本学期总周数",
        "请输入本学期总周数（默认 20，范围 1-55）:",
        "20",
        "validateWeeksInput"
    );
}

// ---------- 主流程 ----------

async function run() {
    try {
        const confirmed = await promptUserToStart();
        if (!confirmed) { AndroidBridge.showToast("用户取消了导入。"); return; }

        const weeksInput = await getTotalWeeks();
        if (weeksInput === null) { AndroidBridge.showToast("导入已取消。"); return; }
        const totalWeeks = parseInt(weeksInput, 10);
        if (isNaN(totalWeeks) || totalWeeks < 1) { AndroidBridge.showToast("周数设置无效。"); return; }
        const defaultWeeks = Array.from({ length: totalWeeks }, (_, i) => i + 1);

        AndroidBridge.showToast("正在解析课表数据...");
        const { courses: parsedCourses, html: pageHtml } = parseCourseTableFromCurrentPage();

        if (parsedCourses.length === 0) {
            // 解析失败时给出更具体的提示
            let detail = "";
            if (!pageHtml.includes('星期一')) {
                detail = '当前页面不包含课表表格。请确认：\n' +
                    '1. 已进入学生课表查询页面\n' +
                    '2. 已选择学年学期并点击【查询】\n' +
                    '3. 课表已正常显示（页面中能看到"星期一"表头）';
            } else if (pageHtml.includes('星期一') && document.querySelectorAll('table').length > 0) {
                detail = '已找到包含"星期一"的课表表格，但未能从中解析出有效的课程数据。\n' +
                    '请确认已从下拉菜单中选择了正确的学年学期，并点击了【查询/确定】按钮。\n\n' +
                    '常见问题：\n' +
                    '1. 页面加载后未点击【查询】按钮\n' +
                    '2. 当前学期没有课程安排（课表空白）\n' +
                    '3. 选错了学年或学期';
            } else {
                detail = '未能在当前页面中找到课表数据。\n' +
                    '请确认已在学生课表查询页面正确选择了学期并点击了【查询】。';
            }
            await window.AndroidBridgePromise.showAlert("未解析到课程", detail, "确定");
            return;
        }

        const coursesWithWeeks = parsedCourses.map(c => ({
            name: c.name, teacher: c.teacher, position: c.position,
            day: c.day, startSection: c.startSection, endSection: c.endSection,
            weeks: c.weeks.length > 0 ? c.weeks : defaultWeeks,
        }));

        try {
            await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(coursesWithWeeks));
            AndroidBridge.showToast(`课程数据已导入（共 ${coursesWithWeeks.length} 条）`);
        } catch (saveErr) {
            console.error("[JXNU] 保存课程失败:", saveErr);
            await window.AndroidBridgePromise.showAlert("保存课程失败", saveErr.message || String(saveErr), "确定");
            return;
        }

        const timeSlots = getTimeSlots();
        try {
            await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            AndroidBridge.showToast("时间段数据已导入");
        } catch (slotErr) {
            console.error("[JXNU] 保存时间段失败:", slotErr);
            AndroidBridge.showToast(`时间段保存失败：${slotErr.message}`);
        }

        AndroidBridge.showToast("导入完成！");
        AndroidBridge.notifyTaskCompletion();
    } catch (err) {
        console.error("[JXNU] 导入流程出错:", err);
        try {
            await window.AndroidBridgePromise.showAlert("导入失败", `未知错误：${err.message || err}\n\n请联系开发者。`, "确定");
        } catch (_) {}
        AndroidBridge.notifyTaskCompletion();
    }
}

run();
