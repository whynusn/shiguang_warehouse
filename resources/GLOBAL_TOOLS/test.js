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
 * 支持格式：
 *   "3"       → 单个节次
 *   "1\n2"    → 换行分隔的多节次（<br> 在 textContent 中变 \n）
 *   "6\n7"    → 同上
 *   "1-2"     → 短横分隔
 *   "晚上"    → 晚间节次
 */
function isPeriodLabel(text) {
    const t = text.trim();
    if (!t) return false;

    // 原始文本含换行 → 按换行拆分，每部分都应是有效节次数字
    if (t.includes('\n')) {
        const parts = t.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        if (parts.length >= 2) {
            return parts.every(p => /^\d{1,2}$/.test(p) && parseInt(p) >= 1 && parseInt(p) <= UNIT_COUNT);
        }
    }

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
 * "1" → [1], "3-4" → [3,4], "1\n2" → [1,2], "晚上" → [11,12,13]
 */
function parsePeriodText(text) {
    const t = text.trim();
    if (t.includes('晚')) return [11, 12, 13];

    // 优先检查原始文本中是否有换行或空白分隔符（如 "1\n2"）
    // 按 \n 或空白分割，每个部分独立解析为单个节次
    if (t.includes('\n') || t.includes('\r') || /\s{2,}/.test(t)) {
        const parts = t.split(/[\n\r]+/).map(s => s.trim()).filter(s => s.length > 0);
        if (parts.length >= 2) {
            const nums = [];
            for (const p of parts) {
                const n = parseInt(p);
                if (n >= 1 && n <= UNIT_COUNT && !nums.includes(n)) nums.push(n);
            }
            if (nums.length >= 2) { nums.sort((a, b) => a - b); return nums; }
        }
    }

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

    // 检查 cleaned 是否可以拆分为多个单个数字（如 "12" → [1,2]）
    // 规则：如果 cleaned 长度 > 1 且每个字符都是 1-9 的数字
    if (cleaned.length > 1) {
        const allSingleDigits = [...cleaned].every(ch => /^[1-9]$/.test(ch));
        if (allSingleDigits) {
            const nums = [];
            for (const ch of cleaned) {
                const n = parseInt(ch);
                if (!nums.includes(n)) nums.push(n);
            }
            nums.sort((a, b) => a - b);
            // 确认是连续的区间
            if (nums.length >= 2 && nums[nums.length - 1] - nums[0] + 1 === nums.length) {
                return nums;
            }
        }
    }

    const singleMatch = cleaned.match(/^(\d{1,2})$/);
    if (singleMatch) {
        const num = parseInt(singleMatch[1]);
        if (num >= 1 && num <= UNIT_COUNT) return [num];
    }

    // 逐个字符解析兜底
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
 * 在指定 window 对象中递归查找课表表格。
 * 匹配条件：表格第一行（表头）必须包含"星期一"且至少有 7 列（周一到周日）。
 * 支持表格位于 iframe 内的情况。
 */
function findCourseTable(win) {
    try {
        for (const t of win.document.querySelectorAll('table')) {
            // 初级筛选：表格内容要包含"星期一"
            if (!t.textContent.includes('星期一')) continue;
            // 中级筛选：表格第一行必须有至少 7 列
            if (t.rows.length === 0) continue;
            const firstRow = t.rows[0];
            if (firstRow.cells.length < 7) continue;
            // 高级筛选：第一行某列确实包含"星期一"文本
            let hasMondayHeader = false;
            for (let c = 0; c < firstRow.cells.length; c++) {
                if (firstRow.cells[c].textContent.includes('星期一')) {
                    hasMondayHeader = true;
                    break;
                }
            }
            if (hasMondayHeader) return t;
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

    const headerRow = rows[headerRowIdx];
    const totalCols = headerRow.cells.length;
    console.log(`[JXNU] 表头共 ${totalCols} 列`);

    // 定位"星期一"所在列
    let firstDayCol = -1;
    for (let c = 0; c < totalCols; c++) {
        const t = headerRow.cells[c].textContent.trim().replace(/\s+/g, '');
        console.log(`[JXNU]   列 ${c}: "${t}"`);
        if (t.includes('星期一')) firstDayCol = c;
    }
    if (firstDayCol < 0) {
        console.warn("[JXNU] 未找到星期一的表头列");
        return { courses, html: pageHtml };
    }

    // dayColMap: 表头列索引 → 星期几
    const dayColMap = {};
    for (let c = firstDayCol; c < totalCols && c - firstDayCol < 7; c++) {
        dayColMap[c] = c - firstDayCol + 1;
    }
    console.log(`[JXNU] 星期一在列 ${firstDayCol}，dayColMap:`, JSON.stringify(dayColMap));

    // periodLabelCol = 星期一的前一列
    const periodLabelCol = firstDayCol - 1;
    console.log(`[JXNU] periodLabelCol=${periodLabelCol}`);

    // rowspan 追踪
    const rowspanActive = new Array(totalCols).fill(0);
    let totalPeriodRows = 0;

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        const cells = row.cells;
        if (cells.length < 2) {
            console.log(`[JXNU]   行 ${r}: 只有 ${cells.length} 格（分隔行）`);
            continue;
        }

        // ---- 用 Column-pass 算法遍历 ----
        // 按 header 列顺序扫，跳过 rowspan 覆盖的列
        let periodText = '', foundPeriod = false;
        let periods = [], courseData = [];
        let cellIdx = 0;

        for (let col = 0; col < totalCols && cellIdx < cells.length; col++) {
            if (rowspanActive[col] > 0) { rowspanActive[col]--; continue; }

            const cell = cells[cellIdx++];
            if (cell.rowSpan > 1) rowspanActive[col] = cell.rowSpan - 1;

            const text = cell.textContent.trim();

            // 方案A：如果 col == periodLabelCol，用列位置判断
            // 方案B：同时检查 col > periodLabelCol 的短表格情况
            if (col === periodLabelCol) {
                if (text && isPeriodLabel(text)) {
                    periodText = text; periods = parsePeriodText(text);
                    foundPeriod = periods.length > 0;
                }
                if (foundPeriod) console.log(`[JXNU]   行${r} period: "${text.replace(/\s+/g,' ')}" → [${periods}]`);
            }

            // 如果是课程列，尝试从中提取课程名（用 isPeriodLabel 排除误判）
            if (dayColMap[col] && text && text.length >= 2 && text !== '\u00a0') {
                const cleanText = text.replace(/\s+/g, '');
                const skipWords = ['上午', '下午', '晚上', '中午', '中 午', '午休', '节次'];
                if (!skipWords.includes(cleanText) && text.length > 2) {
                    courseData.push({ cell, text, day: dayColMap[col] });
                    console.log(`[JXNU]   行${r} col${col}(周${dayColMap[col]}): "${text.replace(/\s+/g,' ').substring(0,60)}"`);
                }
            }
        }

        // 如果没找到 period → 尝试方案C：扫描当前行所有格找 period
        if (!foundPeriod) {
            for (let ci = 0; ci < cells.length; ci++) {
                const t = cells[ci].textContent.trim();
                if (t && isPeriodLabel(t)) {
                    periodText = t; periods = parsePeriodText(t);
                    foundPeriod = periods.length > 0;
                    console.log(`[JXNU]   行${r} [方案C] 扫描找到 period: "${t.replace(/\s+/g,' ')}" 在 cell[${ci}]`);
                    break;
                }
            }
        }

        if (!foundPeriod) {
            console.log(`[JXNU]   行${r}: 未找到节次标签`);
            continue;
        }

        totalPeriodRows++;
        let rowCount = 0;

        for (const { cell, text, day } of courseData) {
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
                } else { name = ''; }
            }

            if (!name) {
                const parsed = parseCellText(text);
                if (!parsed || !parsed.name) {
                    console.log(`[JXNU]     parseCellText失败: "${text.replace(/\s+/g,' ').substring(0,60)}"`);
                    continue;
                }
                name = parsed.name; teacher = parsed.teacher || teacher; room = parsed.room || room;
            }

            name = name.replace(/\s+/g, '');
            if (!/[\u4e00-\u9fa5a-zA-Z]/.test(name)) continue;

            courses.push({ name, teacher: teacher || '', position: room || '',
                day, startSection: periods[0], endSection: periods[periods.length - 1], weeks: [] });
            rowCount++;
        }
        console.log(`[JXNU]   行${r}: 解析到 ${rowCount} 门课`);
    }

    console.log(`[JXNU] 共 ${totalPeriodRows} 行数据`);

    // ---- Step: 合并相邻节次的相同课程 ----
    // 如 {name:"高数",day:1,section:[1,2]} + {name:"高数",day:1,section:[3,3]}
    // → {name:"高数",day:1,section:[1,3]}
    courses.sort((a, b) => a.day - b.day || a.startSection - b.startSection);
    const merged = [];
    for (const c of courses) {
        if (merged.length === 0) { merged.push(c); continue; }
        const prev = merged[merged.length - 1];
        const sameCourse = prev.name === c.name && prev.teacher === c.teacher
            && prev.position === c.position && prev.day === c.day;
        if (sameCourse && prev.endSection + 1 === c.startSection) {
            // 合并：扩展前一条的 endSection
            prev.endSection = c.endSection;
            console.log(`[JXNU] 合并课程: "${c.name}" 周${c.day} ${c.startSection}节→${prev.endSection}节`);
        } else {
            merged.push(c);
        }
    }

    console.log(`[JXNU] 合并后: ${courses.length} → ${merged.length} 条`);
    return { courses: merged, html: pageHtml };
}

// ---------- 时间段配置 ----------

function getTimeSlots() {
    return [
        { number: 1, startTime: "08:00", endTime: "08:40" },
        { number: 2, startTime: "08:50", endTime: "09:30" },
        { number: 3, startTime: "09:40", endTime: "10:20" },
        { number: 4, startTime: "10:30", endTime: "11:10" },
        { number: 5, startTime: "11:20", endTime: "12:00" },
        { number: 6, startTime: "14:00", endTime: "14:40" },
        { number: 7, startTime: "14:50", endTime: "15:30" },
        { number: 8, startTime: "15:40", endTime: "16:20" },
        { number: 9, startTime: "16:30", endTime: "17:10" },
        { number: 10, startTime: "19:00", endTime: "19:40" },
        { number: 11, startTime: "19:50", endTime: "20:30" },
        { number: 12, startTime: "20:40", endTime: "21:20" },
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

/**
 * 从页面上当前选中的学期下拉框中读取学期开学日期。
 * 下拉框的 value 格式为 "2026/9/1 0:00:00"（开学日期 + 时间）
 */
function getSemesterConfig() {
    const ddl = document.getElementById('_ctl1_ddlSterm');
    if (!ddl || !ddl.value) {
        console.warn("[JXNU] 未找到学期下拉框");
        return null;
    }
    const dateStr = ddl.value.split(' ')[0]; // "2026/9/1 0:00:00" → "2026/9/1"
    const parts = dateStr.split('/');
    if (parts.length !== 3) {
        console.warn("[JXNU] 无法解析学期日期:", ddl.value);
        return null;
    }
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

    // 格式化 YYYY-MM-DD
    const pad = (n) => n.toString().padStart(2, '0');
    const semesterStartDate = `${year}-${pad(month)}-${pad(day)}`;

    const semesterTotalWeeks = 20;

    console.log(`[JXNU] 学期配置: start=${semesterStartDate}, weeks=${semesterTotalWeeks}`);
    return { semesterStartDate, semesterTotalWeeks };
}

// ---------- 主流程 ----------

async function run() {
    try {
        const confirmed = await promptUserToStart();
        if (!confirmed) { AndroidBridge.showToast("用户取消了导入。"); return; }

        // 从学期下拉框自动读取开学日期和总周数
        const semesterCfg = getSemesterConfig();
        const totalWeeks = (semesterCfg && semesterCfg.semesterTotalWeeks) ? semesterCfg.semesterTotalWeeks : 20;
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

        // 保存学期配置（开学日期、总周数）
        if (semesterCfg) {
            try {
                await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(semesterCfg));
                console.log("[JXNU] 学期配置已保存:", semesterCfg);
            } catch (cfgErr) {
                console.error("[JXNU] 保存学期配置失败:", cfgErr);
            }
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
