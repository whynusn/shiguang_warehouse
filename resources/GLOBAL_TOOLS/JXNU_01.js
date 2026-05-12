// 文件: JXNU_01.js
// 功能：从江西师范大学正方教务系统获取课程表 HTML，用 DOM 解析后导入到拾光课程表
// 适配：正方教务系统（课表 HTML 页面抓取 + DOM 解析）
// 维护者：heybuddy

// ---------- 常量配置 ----------

// 获取课表 HTML 页面的接口（已在浏览器登录，fetch 复用 cookie）
const post_url = String.raw`https://jwc.jxnu.edu.cn/User/default.aspx?=&=&code=111&uctl=MyControl\xfz_kcb.ascx&MyAction=Personal`;

const UNIT_COUNT = 13; // 每天最大节次数

// ---------- 全局验证函数 ----------

/**
 * 验证学年输入格式
 */
function validateYearInput(input) {
    if (/^\d{4}$/.test(input)) {
        return false;
    }
    return "请输入四位数字的年份（例如 2024）";
}

/**
 * 验证周数输入
 */
function validateWeeksInput(input) {
    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1 || num > 55) {
        return "请输入 1-55 之间的有效周数";
    }
    return false;
}

// ---------- 单元格文本解析 ----------

/**
 * 从课程格子文本中提取课程名、教师、教室
 *
 * 正方系统中的格子文本格式示例：
 *   "军事理论(W7103)合班吕俊.4班"      → name=军事理论, room=W7103, teacher=吕俊
 *   "大学英语(名达楼2413)教工张三#"     → name=大学英语, room=名达楼2413, teacher=张三
 *   "体育(风雨球馆)合班李四.25班"        → name=体育, room=风雨球馆, teacher=李四
 *   "毛概(惟义楼2201)"                  → name=毛概, room=惟义楼2201, teacher=(空)
 *
 * @param {string} line - 单元格文本
 * @returns {Object|null} {name, teacher, room} 或 null（无效文本）
 */
function parseCellText(line) {
    line = line.trim();
    if (line.length < 3) return null;

    let room = '';
    let name = '';
    let teacher = '';

    // 提取括号里的教室，如 "(W7103)" → "W7103"
    const rmMatch = line.match(/\(([^)]+)\)/);
    if (rmMatch) {
        room = rmMatch[1].trim();

        // 课程名 = 括号前面的全部文字
        name = line.substring(0, line.indexOf('(' + rmMatch[1] + ')')).trim();

        // 括号后面的文字 → 解析教师
        const after = line.substring(
            line.indexOf('(' + rmMatch[1] + ')') + rmMatch[1].length + 2
        ).trim();

        // 合班格式："合班吕俊" 或 "合班吕俊.4班"
        const hbMatch = after.match(/合班(.+?)(?:$|\.\d+班|\s)/);
        if (hbMatch) {
            teacher = hbMatch[1].trim();
        }

        // 教工格式："教工张三#" 或 "教工张三"
        if (!teacher) {
            const jgMatch = after.match(/教工(.+?)(?:#|$|\s)/);
            if (jgMatch) teacher = jgMatch[1].trim();
        }

        // 兜底：括号后面没有合班/教工前缀，直接取文本
        if (!teacher && after.length > 0 && !after.match(/^\d+班$/)) {
            teacher = after.replace(/\.\d+班$/, '').trim();
        }
    } else {
        // 没有括号，整行就是课程名
        name = line;
    }

    // 清理课程名：去空格
    name = name.replace(/\s+/g, '');

    // 有效性检查：不含中文或字母则跳过（空格子、纯数字等）
    if (!/[\u4e00-\u9fa5a-zA-Z]/.test(name)) return null;
    if (name.length > 50) name = name.substring(0, 50);

    return { name, teacher, room };
}

/**
 * 判断单元格文本是否是"节次标签"（如 "1"、"3-4"、"晚上" 等）
 */
function isPeriodLabel(text) {
    const t = text.trim();
    if (!t) return false;

    const cleaned = t.replace(/\s+/g, '');

    // 单个数字 1-9
    if (/^[1-9]$/.test(cleaned)) return true;
    // 两位数字 ≤ 13
    if (/^(1[0-3]?)$/.test(cleaned) && parseInt(cleaned) <= UNIT_COUNT) return true;
    // 范围格式 "3-4"、"6-7"
    if (/^\d{1,2}[-–,]\d{1,2}$/.test(cleaned)) {
        const parts = cleaned.split(/[-–,]/);
        const s = parseInt(parts[0]);
        const e = parseInt(parts[1]);
        if (s >= 1 && e <= UNIT_COUNT && s <= e) return true;
    }
    // "晚上"、"晚自习" 等
    if (t.includes('晚') && (t.includes('上') || t.includes('自'))) return true;

    return false;
}

/**
 * 从节次标签文本解析出节次数字数组
 *
 * "1"       → [1]
 * "3-4"     → [3, 4]
 * "12"      → [1, 2]  (连写，逐个字符解析)
 * "晚上"    → [11, 12, 13]
 *
 * @param {string} text - 节次标签文本
 * @returns {number[]} 节次编号数组
 */
function parsePeriodText(text) {
    const t = text.trim();

    // 晚上 → 11, 12, 13 节
    if (t.includes('晚')) return [11, 12, 13];

    const cleaned = t.replace(/\s+/g, '');

    // "3-4" 或 "6,7" 格式 → 范围展开
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

    // 单个数字
    const singleMatch = cleaned.match(/^(\d{1,2})$/);
    if (singleMatch) {
        const num = parseInt(singleMatch[1]);
        if (num >= 1 && num <= UNIT_COUNT) return [num];
    }

    // 连写 "12" → [1, 2]、"34" → [3, 4]、"345" → [3,4,5]
    const nums = [];
    for (let i = 0; i < cleaned.length; i++) {
        const n = parseInt(cleaned[i]);
        if (n >= 1 && n <= 9 && !nums.includes(n)) nums.push(n);
    }
    if (nums.length > 0) {
        // 验证连续性
        nums.sort((a, b) => a - b);
        return nums;
    }

    return [];
}

// ---------- DOM 解析 ----------

/**
 * 从 DOMParser 解析后的 Document 中，用 table.rows API 提取课程数据。
 *
 * 核心思路：
 *   1. 找到包含"星期一"表头的表格
 *   2. 用 table.rows 逐行遍历（浏览器自动处理 rowspan/colspan 的格索引）
 *   3. 每行先读 cells[0] 节次标签，再读 cells[1..] 获取各天课程
 *   4. 优先尝试结构化提取（cell.querySelector），兜底用 textContent
 *
 * 为什么不用正则/平铺 querySelectorAll：
 *   - 当存在 rowspan 时，平铺列表的索引与"星期列"不对齐，导致数据错位
 *   - table.rows[r].cells 由浏览器维护，rowspan 覆盖的格自动消失
 *
 * @param {Document} doc - DOMParser 解析后的文档对象
 * @returns {Array} 课程对象数组 [{name, teacher, position, day, startSection, endSection, weeks}]
 */
function parseCourseTableFromDOM(doc) {
    const courses = [];
    const dayNames = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

    // ---- Step 1: 找到包含 "星期一" 的课表表格 ----
    const tables = doc.querySelectorAll('table');
    let table = null;
    for (const t of tables) {
        if (t.textContent.includes('星期一')) {
            table = t;
            break;
        }
    }
    if (!table) {
        console.warn("[JXNU] 未找到课表表格");
        return courses;
    }

    // ---- Step 2: 遍历行，找到表头行 ----
    const rows = table.rows;
    if (rows.length < 3) {
        console.warn("[JXNU] 课表格行数不足:", rows.length);
        return courses;
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
        return courses;
    }

    // 从表头行建立"列索引 → 星期几"的映射
    const headerRow = rows[headerRowIdx];
    const dayColMap = {}; // col index → day (1-7)
    let dayCounter = 1;
    for (let c = 1; c < headerRow.cells.length && dayCounter <= 7; c++) {
        const text = headerRow.cells[c].textContent.trim().replace(/\s+/g, '');
        // 只要能映射的列都按顺序赋予星期
        dayColMap[c] = dayCounter;
        dayCounter++;
    }

    // ---- Step 3: 遍历数据行 ----
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        const cells = row.cells;
        if (cells.length < 2) continue;

        // 第 1 格 = 节次标签
        const periodText = cells[0].textContent.trim();
        if (!periodText || !isPeriodLabel(periodText)) continue;

        const periods = parsePeriodText(periodText);
        if (periods.length === 0) continue;

        // 遍历当前行的课程格（跳过 cells[0] 节次标签）
        // 使用 dayColMap 将列索引映射到星期几
        let cellIdx = 1; // cells 中的真实索引
        for (let col = 1; col <= 7 && cellIdx < cells.length; col++) {
            const day = dayColMap[col];
            if (!day) continue;

            // 浏览器 rowspan 机制：如果此格被上层 rowspan 覆盖，
            // cells[cellIdx] 已经是下一列的格了（不会读漏）
            const cell = cells[cellIdx];
            cellIdx++;

            const cellText = cell.textContent.trim();
            if (!cellText || cellText.length < 2) continue;

            // 跳过非课程文本
            const cleanText = cellText.replace(/\s+/g, '');
            if (['上午', '下午', '晚上', '中午', '中 午', '午休', '节次'].some(k => cleanText === k)) continue;

            // 解析课程
            let name = '', teacher = '', room = '';

            // 优先尝试结构化提取（正方新版：<div class="timetable_con"> 内按 p 排列）
            const titleEl = cell.querySelector('.title font, .title');
            if (titleEl) {
                name = titleEl.textContent.trim();
                // 地点：通常在第二个 <p> 的 <font>
                const pEls = cell.querySelectorAll('p font');
                if (pEls.length >= 2) {
                    room = pEls[1].textContent.trim();
                }
                if (pEls.length >= 1) {
                    // 文本可能在第一个 p（含地点的那个）或者 
                    // 教师可能在 pEls[0] 或 pEls[2]
                    if (pEls.length >= 3) {
                        teacher = pEls[2].textContent.trim();
                    }
                    // 尝试从地点提取
                    const posText = pEls[0].textContent.trim();
                    // 如果 posText 看起来是地点（含楼、馆、教室等关键词），用它作为位置
                    if (/[楼馆教栋区斋轩堂室]/.test(posText) && !room) {
                        room = posText;
                    }
                }
            }

            // 结构化提取失败，回退到 textContent + parseCellText
            if (!name) {
                const parsed = parseCellText(cellText);
                if (!parsed || !parsed.name) continue;
                name = parsed.name;
                teacher = parsed.teacher || teacher;
                room = parsed.room || room;
            }

            // 清理
            name = name.replace(/\s+/g, '');
            if (!/[\u4e00-\u9fa5a-zA-Z]/.test(name)) continue;

            courses.push({
                name: name,
                teacher: teacher || '',
                position: room || '',
                day: day,
                startSection: periods[0],
                endSection: periods[periods.length - 1],
                weeks: [],
            });
        }
    }

    // ---- Step 4: 去重 ----
    const seen = new Set();
    const deduped = [];
    for (const c of courses) {
        const key = `${c.name}|${c.day}|${c.startSection}|${c.endSection}|${c.teacher}|${c.position}`;
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(c);
        }
    }

    console.log(`[JXNU] DOM 解析完成，原始=${courses.length}，去重后=${deduped.length} 条课程`);
    return deduped;
}

// ---------- 时间段配置 ----------

/**
 * 获取江西师范大学作息时间表
 * 参考：江西师范大学 上课时间表
 *   第1节 08:00-08:45
 *   第2节 08:50-09:35
 *   第3节 09:50-10:35
 *   第4节 10:40-11:25
 *   第5节 11:30-12:15
 *   第6节 14:00-14:45
 *   第7节 14:50-15:35
 *   第8节 15:50-16:35
 *   第9节 16:40-17:25
 *   第10节 18:30-19:15
 *   第11节 19:20-20:05
 *   第12节 20:10-20:55
 *   第13节 21:00-21:45
 */
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

/**
 * 提示用户确认开始导入
 */
async function promptUserToStart() {
    return await window.AndroidBridgePromise.showAlert(
        "江西师范大学 课表导入",
        "请确认：\n1. 已在浏览器中登录教务系统\n2. 已进入学生课表查询页面并选择了正确的学年学期\n3. 已点击【查询】按钮，课表已正常显示\n\n点击确定开始导入。",
        "确定，开始导入"
    );
}

/**
 * 获取用户输入的学期总周数
 */
async function getTotalWeeks() {
    return await window.AndroidBridgePromise.showPrompt(
        "设置本学期总周数",
        "请输入本学期总周数（默认 20，范围 1-55）:",
        "20",
        "validateWeeksInput"
    );
}

// ---------- 主流程 ----------

/**
 * 主流程：协调整个课表导入
 */
async function run() {
    try {
        // 1. 公告提示
        const confirmed = await promptUserToStart();
        if (!confirmed) {
            AndroidBridge.showToast("用户取消了导入。");
            return;
        }

        // 2. 获取总周数
        const weeksInput = await getTotalWeeks();
        if (weeksInput === null) {
            AndroidBridge.showToast("导入已取消。");
            return;
        }
        const totalWeeks = parseInt(weeksInput, 10);
        if (isNaN(totalWeeks) || totalWeeks < 1) {
            AndroidBridge.showToast("周数设置无效。");
            return;
        }
        // 默认周次：第 1 周到总周数（如果单元格内无法提取周次信息，则使用此默认值）
        const defaultWeeks = Array.from({ length: totalWeeks }, (_, i) => i + 1);

        // 3. 请求课表 HTML
        AndroidBridge.showToast("正在获取课表数据，请稍候...");
        let html = '';
        try {
            const response = await fetch(post_url, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9',
                },
            });
            if (!response.ok) {
                throw new Error(`HTTP 请求失败，状态码: ${response.status}`);
            }
            html = await response.text();
        } catch (fetchErr) {
            console.error("[JXNU] 网络请求失败:", fetchErr);
            await window.AndroidBridgePromise.showAlert(
                "网络请求失败",
                `获取教务系统课表数据失败：${fetchErr.message}\n\n请检查网络连接和登录状态。`,
                "确定"
            );
            return;
        }

        // 检查返回内容是否有效
        if (!html || html.length < 200) {
            await window.AndroidBridgePromise.showAlert(
                "数据异常",
                "获取到的页面内容过短或为空，请确认已成功登录教务系统。",
                "确定"
            );
            return;
        }

        // 检查是否跳转到了登录页（未登录状态）
        if (html.includes('登录') && html.includes('密码') && html.length < 5000) {
            await window.AndroidBridgePromise.showAlert(
                "未检测到登录状态",
                "当前未能检测到有效的登录会话。\n请先在浏览器中登录教务系统后再试。",
                "确定"
            );
            return;
        }

        // 4. 用 DOM 解析课表 HTML
        AndroidBridge.showToast("正在解析课表数据...");
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const parsedCourses = parseCourseTableFromDOM(doc);

        if (parsedCourses.length === 0) {
            await window.AndroidBridgePromise.showAlert(
                "未解析到课程",
                "未能从课表页面解析出课程数据。可能的原因：\n" +
                "1. 未在课表查询页面选择学期并点击【查询】\n" +
                "2. 当前学期没有课程安排\n" +
                "3. 教务系统页面结构发生变化",
                "确定"
            );
            return;
        }

        // 5. 为课程填充默认周次
        const coursesWithWeeks = parsedCourses.map(c => ({
            name: c.name,
            teacher: c.teacher,
            position: c.position,
            day: c.day,
            startSection: c.startSection,
            endSection: c.endSection,
            weeks: c.weeks.length > 0 ? c.weeks : defaultWeeks,
        }));

        // 6. 保存课程
        try {
            await window.AndroidBridgePromise.saveImportedCourses(
                JSON.stringify(coursesWithWeeks)
            );
            AndroidBridge.showToast(`课程数据已导入（共 ${coursesWithWeeks.length} 条）`);
        } catch (saveErr) {
            console.error("[JXNU] 保存课程失败:", saveErr);
            await window.AndroidBridgePromise.showAlert(
                "保存课程失败",
                saveErr.message || String(saveErr),
                "确定"
            );
            return;
        }

        // 7. 保存时间段
        const timeSlots = getTimeSlots();
        try {
            await window.AndroidBridgePromise.savePresetTimeSlots(
                JSON.stringify(timeSlots)
            );
            AndroidBridge.showToast("时间段数据已导入");
        } catch (slotErr) {
            console.error("[JXNU] 保存时间段失败:", slotErr);
            AndroidBridge.showToast(`时间段保存失败：${slotErr.message}`);
        }

        // 8. 完成通知
        AndroidBridge.showToast("导入完成！");
        AndroidBridge.notifyTaskCompletion();
    } catch (err) {
        console.error("[JXNU] 导入流程出错:", err);
        try {
            await window.AndroidBridgePromise.showAlert(
                "导入失败",
                `未知错误：${err.message || err}\n\n请联系开发者。`,
                "确定"
            );
        } catch (_) {
            // alert 失败不做特殊处理
        }
        AndroidBridge.notifyTaskCompletion();
    }
}

// 启动
run();
