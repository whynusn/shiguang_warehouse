// 河北地质大学华信学院强智教务 (61.182.88.214:8090) 拾光课程表适配脚本
// 非该大学开发者适配，开发者无法及时发现问题
// 出现问题请联系开发者或者提交 pr 更改，这更加快速

/**
 * 解析周次字符串为数组
 */
function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;

    // 移除"周"字、括号和节次信息
    const pureWeekData = weekStr.replace(/周|\(.*?\)|\[\d+-\d+ 节\]/g, '').trim();
    if (!pureWeekData) return weeks;

    // 分割并处理每个段
    const segments = pureWeekData.split(',');
    segments.forEach(seg => {
        seg = seg.trim();
        if (!seg) return;
        
        if (seg.includes('-')) {
            const [start, end] = seg.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) {
                    weeks.push(i);
                }
            }
        } else {
            const w = parseInt(seg);
            if (!isNaN(w)) {
                weeks.push(w);
            }
        }
    });

    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 合并连续节次的相同课程
 */
function mergeAndDistinctCourses(courses) {
    if (courses.length <= 1) return courses;
    
    // 排序以便合并
    courses.sort((a, b) => {
        if (a.name !== b.name) return a.name.localeCompare(b.name);
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        if (a.teacher !== b.teacher) return a.teacher.localeCompare(b.teacher);
        if (a.position !== b.position) return a.position.localeCompare(b.position);
        return a.weeks.join(',').localeCompare(b.weeks.join(','));
    });

    const merged = [];
    let current = courses[0];

    for (let i = 1; i < courses.length; i++) {
        const next = courses[i];

        // 判断是否为同一门课程
        const isSameCourse =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        // 判断节次是否连续
        const isContinuous = (current.endSection + 1 === next.startSection);

        if (isSameCourse && isContinuous) {
            // 合并连续节次
            current.endSection = next.endSection;
        } else if (!(isSameCourse && current.startSection === next.startSection && current.endSection === next.endSection)) {
            merged.push(current);
            current = next;
        }
    }
    merged.push(current);
    return merged;
}

/**
 * 将 HTML 源码解析为课程模型
 */
function parseTimetableToModel(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, "text/html");
    const timetable = doc.getElementById('kbtable');
    if (!timetable) {
        console.log('未找到课表表格元素');
        return [];
    }

    let rawCourses = [];
    const rows = Array.from(timetable.querySelectorAll('tr')).filter(r => r.querySelector('td'));
    console.log('找到课表行：', rows.length);

    rows.forEach((row, rowIndex) => {
        const cells = row.querySelectorAll('td');
        console.log(`第 ${rowIndex} 行，找到 ${cells.length} 个单元格`);
        
        cells.forEach((cell, dayIndex) => {
            const day = dayIndex + 1; // 星期几（1-7）
            
            // 获取所有课程详情 div，包括所有状态的
            const detailDivs = Array.from(cell.querySelectorAll('div.kbcontent'));
            console.log(`第 ${dayIndex} 天，找到 ${detailDivs.length} 个课程 div`);
            
            detailDivs.forEach((detailDiv, divIndex) => {
                const rawHtml = detailDiv.innerHTML.trim();
                const innerText = detailDiv.innerText.trim();
                console.log(`第 ${divIndex} 个 div，内容：`, innerText.substring(0, 100));
                
                if (!rawHtml || rawHtml === "&nbsp;" || innerText.length < 2) return;

                // 分割同一个格子内的多门课程
                const blocks = rawHtml.split(/---------------------|----------------------/);
                console.log(`分割出 ${blocks.length} 个课程块`);

                blocks.forEach((block, blockIndex) => {
                    if (!block.trim()) return;
                    
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = block;

                    // 1. 提取课程名（包含所有文本，包括实验标记）
                    let name = "";
                    const firstLine = tempDiv.innerHTML.split('<br>')[0].trim();
                    // 移除HTML标签，保留文本内容
                    name = firstLine.replace(/<[^>]*>/g, '').trim();
                    console.log(`课程名：${name}`);
                    
                    if (!name) return;

                    // 2. 提取周次和节次信息
                    const weekFont = tempDiv.querySelector('font[title="周次(节次)"]');
                    const weekFull = weekFont?.innerText || "";
                    console.log(`周次和节次信息：${weekFull}`);
                    let startSection = 0;
                    let endSection = 0;
                    let weekStr = "";

                    // 匹配 "1-17(周)[01-02节]" 格式
                    const weekSectionMatch = weekFull.match(/(.+?)\(周\)\[(\d+)-(\d+)节\]/);
                    if (weekSectionMatch) {
                        weekStr = weekSectionMatch[1]; // "1-17"
                        startSection = parseInt(weekSectionMatch[2], 10);
                        endSection = parseInt(weekSectionMatch[3], 10);
                        console.log(`匹配到格式1：周次=${weekStr}, 开始节次=${startSection}, 结束节次=${endSection}`);
                    } else {
                        // 尝试匹配 "1-17(周)[01-02 节]" 格式（带空格）
                        const weekSectionMatchWithSpace = weekFull.match(/(.+?)\(周\)\[(\d+)-(\d+) 节\]/);
                        if (weekSectionMatchWithSpace) {
                            weekStr = weekSectionMatchWithSpace[1];
                            startSection = parseInt(weekSectionMatchWithSpace[2], 10);
                            endSection = parseInt(weekSectionMatchWithSpace[3], 10);
                            console.log(`匹配到格式2：周次=${weekStr}, 开始节次=${startSection}, 结束节次=${endSection}`);
                        } else {
                            // 尝试匹配其他格式
                            const altMatch = weekFull.match(/(\d+)-(\d+)/);
                            if (altMatch) {
                                weekStr = altMatch[0];
                                // 假设是第1-2节
                                startSection = 1;
                                endSection = 2;
                                console.log(`匹配到格式3：周次=${weekStr}, 开始节次=${startSection}, 结束节次=${endSection}`);
                            } else {
                                console.log('未匹配到周次和节次信息');
                            }
                        }
                    }

                    // 3. 提取教师信息
                    const teacher = tempDiv.querySelector('font[title="老师"]')?.innerText.trim() || "未知教师";
                    console.log(`教师：${teacher}`);

                    // 4. 提取教室地点
                    const position = tempDiv.querySelector('font[title="教室"]')?.innerText.trim() || "未知地点";
                    console.log(`地点：${position}`);

                    if (name && startSection > 0) {
                        const course = {
                            "name": name,
                            "teacher": teacher,
                            "weeks": parseWeeks(weekStr),
                            "position": position,
                            "day": day,
                            "startSection": startSection,
                            "endSection": endSection
                        };
                        rawCourses.push(course);
                        console.log('添加课程：', course);
                    }
                });
            });
        });
    });

    console.log(`原始课程数量：${rawCourses.length}`);
    const mergedCourses = mergeAndDistinctCourses(rawCourses);
    console.log(`合并后课程数量：${mergedCourses.length}`);
    return mergedCourses;
}

/**
 * 从网页中提取学期选项列表
 */
function extractSemesterOptions(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, "text/html");
    const semesterSelect = doc.getElementById('xnxq01id');
    if (!semesterSelect) {
        console.log('未找到学期选择元素');
        return [];
    }
    
    const options = Array.from(semesterSelect.querySelectorAll('option')).map(opt => ({
        value: opt.value,
        text: opt.text
    }));
    
    console.log(`提取到 ${options.length} 个学期选项`);
    return options;
}

/**
 * 从网页中提取作息时间
 */
function extractTimeSlots(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, "text/html");
    const timetable = doc.getElementById('kbtable');
    if (!timetable) return null;
    
    const timeSlots = [];
    const rows = Array.from(timetable.querySelectorAll('tr'));
    
    rows.forEach((row) => {
        const th = row.querySelector('th');
        if (!th) return;
        
        // 提取时间范围，如 "08:30-10:05"
        const timeText = th.innerText.trim();
        const timeMatch = timeText.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
        
        if (timeMatch) {
            const startTime = timeMatch[1];
            const endTime = timeMatch[2];
            
            // 判断是否是有效的时间段（排除"中午"等）
            const sectionName = timeText.split('\n')[0].trim();
            if (startTime && endTime && sectionName !== '中午') {
                // 为每个大节创建两个时间段
                const sections = [
                    {
                        number: timeSlots.length + 1,
                        startTime: startTime,
                        endTime: `${startTime.split(':')[0]}:45`
                    },
                    {
                        number: timeSlots.length + 2,
                        startTime: `${startTime.split(':')[0]}:55`,
                        endTime: endTime
                    }
                ];
                timeSlots.push(...sections);
            }
        }
    });
    
    return timeSlots.length > 0 ? timeSlots : null;
}

/**
 * 显示欢迎提示
 */
async function showWelcomeAlert() {
    return await window.AndroidBridgePromise.showAlert(
        "导入提示",
        "请确保已在内置浏览器中成功登录河北地质大学华信学院教务系统。",
        "开始导入"
    );
}

/**
 * 获取用户选择的学期参数
 */
async function getSemesterParamsFromUser(semesterOptions) {
    if (!semesterOptions || semesterOptions.length === 0) {
        AndroidBridge.showToast("未获取到学期列表");
        return null;
    }
    
    // 直接显示所有学期选项，让用户一次性选择
    const semesterLabels = semesterOptions.map(opt => opt.text);
    
    const semesterIndex = await window.AndroidBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterLabels),
        0 // 默认选择第一个（最新学期）
    );
    
    if (semesterIndex === null) return null;
    
    return semesterOptions[semesterIndex].value;
}

/**
 * 请求课表 HTML 数据
 */
async function fetchCourseHtml() {
    try {
        AndroidBridge.showToast("正在获取课表页面...");
        const response = await fetch("http://61.182.88.214:8090/jsxsd/xskb/xskb_list.do", {
            method: "GET",
            credentials: "include",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const text = await response.text();
        console.log('获取到课表页面，状态码：', response.status);
        return text;
    } catch (error) {
        console.error('获取课表页面失败：', error);
        AndroidBridge.showToast("获取课表页面失败：" + error.message);
        throw error;
    }
}

/**
 * 保存课程数据到 App
 */
async function saveCourseDataToApp(courses, timeSlots) {
    // 保存学期配置
    await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify({
        "semesterTotalWeeks": 20,
        "firstDayOfWeek": 1
    }));

    // 保存作息时间（从网页提取）
    if (timeSlots && timeSlots.length > 0) {
        await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    }

    // 保存课程数据
    return await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
}

/**
 * 主流程控制
 */
async function runImportFlow() {
    try {
        // 1. 显示欢迎提示
        const start = await showWelcomeAlert();
        if (!start) return;

        // 2. 获取课表 HTML（包含学期选项和作息时间）
        AndroidBridge.showToast("正在获取课表页面...");
        const html = await fetchCourseHtml();
        console.log('获取到课表页面 HTML，长度：', html.length);
        
        // 3. 从网页中提取学期选项
        const semesterOptions = extractSemesterOptions(html);
        console.log('学期选项：', semesterOptions);
        
        // 4. 从网页中提取作息时间
        let timeSlots = extractTimeSlots(html);
        if (!timeSlots || timeSlots.length === 0) {
            console.warn("未能从网页提取作息时间，使用默认值");
            // 设置默认作息时间
            timeSlots = [
                { number: 1, startTime: "08:30", endTime: "09:15" },
                { number: 2, startTime: "09:25", endTime: "10:10" },
                { number: 3, startTime: "10:15", endTime: "11:00" },
                { number: 4, startTime: "11:10", endTime: "11:55" },
                { number: 5, startTime: "14:30", endTime: "15:15" },
                { number: 6, startTime: "15:25", endTime: "16:10" },
                { number: 7, startTime: "16:15", endTime: "17:00" },
                { number: 8, startTime: "17:10", endTime: "17:55" },
                { number: 9, startTime: "19:00", endTime: "19:45" },
                { number: 10, startTime: "19:55", endTime: "20:40" }
            ];
        }
        console.log('作息时间：', timeSlots);

        // 5. 让用户选择学期
        const semesterId = await getSemesterParamsFromUser(semesterOptions);
        if (!semesterId) return;
        console.log('选择的学期 ID：', semesterId);

        // 6. 根据选择的学期重新请求课表数据
        AndroidBridge.showToast("正在请求选定学期的课表数据...");
        const response = await fetch("http://61.182.88.214:8090/jsxsd/xskb/xskb_list.do", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `cj0701id=&zc=&demo=&xnxq01id=${semesterId}`,
            credentials: "include"
        });
        const courseHtml = await response.text();
        console.log('获取到选定学期的课表 HTML，长度：', courseHtml.length);

        // 7. 解析课程数据
        const finalCourses = parseTimetableToModel(courseHtml);
        console.log('解析出的课程：', finalCourses);

        if (finalCourses.length === 0) {
            AndroidBridge.showToast("未发现课程，请检查学期选择或登录状态。");
            // 尝试直接从初始 HTML 中解析课程
            const initialCourses = parseTimetableToModel(html);
            console.log('从初始 HTML 解析的课程：', initialCourses);
            if (initialCourses.length > 0) {
                AndroidBridge.showToast("使用初始页面的课程数据");
                await saveCourseDataToApp(initialCourses, timeSlots);
                AndroidBridge.showToast(`成功导入 ${initialCourses.length} 门课程`);
                AndroidBridge.notifyTaskCompletion();
            }
            return;
        }

        // 8. 保存课程数据
        await saveCourseDataToApp(finalCourses, timeSlots);

        AndroidBridge.showToast(`成功导入 ${finalCourses.length} 门课程`);
        AndroidBridge.notifyTaskCompletion();

    } catch (error) {
        console.error('导入异常：', error);
        AndroidBridge.showToast("导入异常：" + error.message);
    }
}

// 启动执行
runImportFlow();