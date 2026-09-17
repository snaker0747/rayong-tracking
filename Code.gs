function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Dashboard ติดตามโครงการสำนักช่าง')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
// แทนที่ '1wuiyJv8PQGZ-4_1bjv-awp182cO0KsPuszYeAb29cfo' ด้วย ID ของ Google Sheet
const SPREADSHEET_ID = '1wuiyJv8PQGZ-4_1bjv-awp182cO0KsPuszYeAb29cfo';
const SUPABASE_URL = 'https://awfenzwfywelxmnnalva.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ZadcQEz6xuirM1CT9HGSTw_D1Cw0xdS';

// Webhook endpoint สำหรับรับข้อมูล POST จาก Vercel / เว็บไซต์ภายนอกเพื่อซิงค์ข้อมูลลง Google Sheet
function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      payload = e.parameter;
    }
    
    const pin = payload.pin || '888888';
    const action = payload.action || 'update';
    
    let result;
    if (action === 'delete') {
      const projectId = payload.projectId || payload.id;
      result = deleteProject(pin, projectId);
    } else if (action === 'sync_staff' || action === 'update_staff') {
      const staffList = payload.staffList || [];
      result = updateStaffListInSheet(pin, staffList);
    } else {
      const projectData = payload.projectData || payload;
      result = updateProject(pin, projectData);
    }
    
    return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ฟังก์ชันลบโครงการออกจาก Google Sheet (ตามลำดับ ID)
function deleteProject(pin, projectId) {
  if (pin !== '888888') {
    return JSON.stringify({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' });
  }
  
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('ตารางติดตามโครงการ');
    if (!sheet) throw new Error("ไม่พบชีตชื่อ 'ตารางติดตามโครงการ'");
    const data = sheet.getDataRange().getValues();
    
    const targetId = (projectId !== undefined && projectId !== null) ? projectId.toString().trim() : '';
    if (!targetId) throw new Error("ไม่ได้ระบุ ID โครงการที่ต้องการลบ");
    
    let foundRow = -1;
    for (let i = 2; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim() === targetId) {
        foundRow = i + 1; // 1-indexed row number
        break;
      }
    }
    
    if (foundRow !== -1) {
      sheet.deleteRow(foundRow);
      return JSON.stringify({ status: 'success', deletedId: targetId, deletedRow: foundRow });
    } else {
      return JSON.stringify({ status: 'warning', message: 'ไม่พบโครงการลำดับที่ ' + targetId + ' ในชีต' });
    }
  } catch (err) {
    return JSON.stringify({ status: 'error', message: err.toString() });
  }
}
function getDashboardData() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    // ดึงข้อมูลจากชีตชื่อ "ตารางติดตามโครงการ"
    const sheet = ss.getSheetByName('ตารางติดตามโครงการ'); 
    if (!sheet) throw new Error("ไม่พบชีตชื่อ 'ตารางติดตามโครงการ'");
    const dataRange = sheet.getDataRange();
    const data = dataRange.getValues();
    
    // โครงสร้างข้อมูลที่จะส่งกลับไปให้ Frontend
    const projects = [];
    
    // ข้าม Header 2 บรรทัดแรก (index 0, 1) และเริ่มอ่านข้อมูลที่ index 2
    for (let i = 2; i < data.length; i++) {
      const row = data[i];
      
      // ข้ามแถวว่าง
      if (!row[1] || row[1].toString().trim() === '') continue; 
      
      // ค้นหาสถานะปัจจุบัน (คอลัมน์สถานะเลื่อนไปเริ่มที่ index 10 ถึง 16)
      let currentStatusIndex = -1;
      let statuses = [];
      
      const statusCols = [10, 11, 12, 13, 14, 15, 16];
      
      for (let colIdx = 0; colIdx < statusCols.length; colIdx++) {
        let s = statusCols[colIdx];
        let statusText = '';
        let hasDate = false;
        if (row[s] instanceof Date) {
          const months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
          let d = row[s];
          let year = d.getFullYear();
          let buddhistYear = year >= 2500 ? year : year + 543;
          statusText = d.getDate() + ' ' + months[d.getMonth()] + ' ' + buddhistYear; 
          hasDate = true;
        } else {
          statusText = row[s] !== undefined ? row[s].toString().trim() : '';
          // ตรวจสอบว่าถ้าเป็นข้อความธรรมดา มีรูปแบบของวันที่ซ่อนอยู่หรือไม่ (เช่น 14/6/2567)
          if (statusText !== '' && /[\d]{1,2}[\/\-][\d]{1,2}[\/\-][\d]{2,4}/.test(statusText)) {
            hasDate = true;
          }
        }
        
        statuses.push(statusText);
        
        // อัปเดตจุดสีส้ม (สถานะล่าสุด) เฉพาะคอลัมน์ที่มีการ "ลงวันที่" เท่านั้น
        if (hasDate) {
           currentStatusIndex = colIdx; // ได้ค่า 0 ถึง 7
        }
      }
      
      // จัดรูปแบบตัวเลขงบประมาณ
      let budgetStr = row[2];
      let budgetNum = parseFloat(budgetStr.toString().replace(/,/g, ''));
      if (isNaN(budgetNum)) budgetNum = 0;
      
      let project = {
        id: row[0], // ลำดับ
        name: row[1], // รายการ
        budget: budgetNum, // งบประมาณ
        budgetType: row[3] !== undefined ? row[3].toString().trim() : '', // ประเภทงบประมาณ
        budgetYear: row[4] !== undefined ? row[4].toString().trim() : '', // ปี พ.ศ.
        operationStatus: row[5] !== undefined ? row[5].toString().trim() : '', // การดำเนินงาน (Col F / index 5)
        budgetDisplay: budgetNum.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
        team: {
          surveyor: row[6], // ผู้สำรวจ (Col G / index 6)
          designer: row[7], // ออกแบบ (Col H / index 7)
          draftsman: row[8], // เขียนแบบ (Col I / index 8)
          estimator: row[9] // ประมาณราคา (Col J / index 9)
        },
        remark: row[19] !== undefined ? row[19].toString().trim() : '', // หมายเหตุ (Col T / index 19)
        currentStatusIndex: currentStatusIndex, 
        statusesText: statuses
      };
      
      projects.push(project);
    }
    
    // ดึงรายชื่อขั้นตอนการทำงานจาก Header ของ Sheet (คอลัมน์ K ถึง Q / index 10 ถึง 16)
    // ลองดึงจากแถวที่ 2 (index 1) ก่อน ถ้าไม่มีให้ดึงจากแถวที่ 1 (index 0)
    const steps = [];
    if (data.length > 0) {
      const headerRow1 = data[1] || [];
      const headerRow0 = data[0] || [];
      for (let col = 10; col <= 16; col++) {
        let stepHeader = headerRow1[col] ? headerRow1[col].toString().trim() : '';
        if (!stepHeader && headerRow0[col]) {
          stepHeader = headerRow0[col].toString().trim();
        }
        steps.push(stepHeader || ('ขั้นตอนที่ ' + (col - 9)));
      }
    }
    
    // ดึงค่าตัวเลือกใน Dropdown จากชีต (สแกนหาในคอลัมน์ D, F, G, H, I, J)
    const budgetTypeOptions = getDropdownOptions(sheet, "D");
    const opStatusOptions = getDropdownOptions(sheet, "F");
    const surveyorOptions = getDropdownOptions(sheet, "G");
    const designerOptions = getDropdownOptions(sheet, "H");
    const draftsmanOptions = getDropdownOptions(sheet, "I");
    const estimatorOptions = getDropdownOptions(sheet, "J");
    
    return JSON.stringify({
      status: 'success',
      data: projects,
      steps: steps,
      options: {
        budgetType: budgetTypeOptions,
        operationStatus: opStatusOptions,
        surveyor: surveyorOptions,
        designer: designerOptions,
        draftsman: draftsmanOptions,
        estimator: estimatorOptions
      }
    });
    
  } catch (error) {
    return JSON.stringify({
      status: 'error',
      message: error.toString()
    });
  }
}

// ฟังก์ชันตรวจสอบ PIN และอัปเดตข้อมูลโครงการ (รองรับทั้งจากภายใน Apps Script และผ่าน Webhook POST จาก Vercel)
function updateProject(pin, projectData) {
  if (pin !== '888888') {
    return JSON.stringify({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' });
  }
  
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('ตารางติดตามโครงการ');
    if (!sheet) throw new Error("ไม่พบชีตชื่อ 'ตารางติดตามโครงการ'");
    const data = sheet.getDataRange().getValues();
    
    let rowIdx = -1;
    let targetId = (projectData.id !== undefined && projectData.id !== null) ? projectData.id.toString().trim() : '';
    
    if (!targetId) {
      // โครงการใหม่ที่ไม่ได้ระบุ ID ให้หา ID สูงสุด + 1
      let maxId = 0;
      for (let i = 2; i < data.length; i++) {
        let currentId = parseInt(data[i][0], 10);
        if (!isNaN(currentId) && currentId > maxId) {
          maxId = currentId;
        }
      }
      targetId = (maxId + 1).toString();
      rowIdx = data.length + 1;
      sheet.getRange(rowIdx, 1).setValue(targetId);
    } else {
      // ค้นหาแถวที่มี ID ตรงกัน (เริ่มค้นหาจากแถวที่ 3 index 2)
      for (let i = 2; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().trim() === targetId) {
          rowIdx = i + 1; // 1-indexed row number
          break;
        }
      }
      // ถ้าไม่พบ ID ในชีต (เช่น เพิ่งเพิ่มจาก Supabase) ให้เพิ่มต่อท้ายแถวใหม่
      if (rowIdx === -1) {
        rowIdx = data.length + 1;
        sheet.getRange(rowIdx, 1).setValue(targetId);
      }
    }
    
    // อัปเดตข้อมูลพื้นฐาน (Col B - F)
    sheet.getRange(rowIdx, 2).setValue(projectData.name || ''); // รายการ
    sheet.getRange(rowIdx, 3).setValue(parseFloat(projectData.budget) || 0); // งบประมาณ
    sheet.getRange(rowIdx, 4).setValue(projectData.budgetType || projectData.budget_type || ''); // ประเภทรายจ่าย
    sheet.getRange(rowIdx, 5).setValue(projectData.budgetYear || projectData.budget_year || ''); // ปี พ.ศ.
    sheet.getRange(rowIdx, 6).setValue(projectData.operationStatus || projectData.operation_status || ''); // การดำเนินงาน
    
    // อัปเดตผู้รับผิดชอบ (Col G - J)
    const surveyor = (projectData.team && projectData.team.surveyor !== undefined) ? projectData.team.surveyor : (projectData.surveyor || '');
    const designer = (projectData.team && projectData.team.designer !== undefined) ? projectData.team.designer : (projectData.designer || '');
    const draftsman = (projectData.team && projectData.team.draftsman !== undefined) ? projectData.team.draftsman : (projectData.draftsman || '');
    const estimator = (projectData.team && projectData.team.estimator !== undefined) ? projectData.team.estimator : (projectData.estimator || '');

    sheet.getRange(rowIdx, 7).setValue(surveyor);
    sheet.getRange(rowIdx, 8).setValue(designer);
    sheet.getRange(rowIdx, 9).setValue(draftsman);
    sheet.getRange(rowIdx, 10).setValue(estimator);
    
    // อัปเดตวันที่ใน 7 ขั้นตอน (Col K ถึง Q)
    const statusCols = [11, 12, 13, 14, 15, 16, 17];
    const statuses = projectData.statusesText || [
      projectData.step_1_date,
      projectData.step_2_date,
      projectData.step_3_date,
      projectData.step_4_date,
      projectData.step_5_date,
      projectData.step_6_date,
      projectData.step_7_date
    ];

    for (let j = 0; j < statusCols.length; j++) {
      let val = (statuses && statuses[j]) ? statuses[j].toString().trim() : '';
      if (val) {
        let dateParts = val.split('-');
        if (dateParts.length === 3) {
          let year = parseInt(dateParts[0], 10);
          let month = parseInt(dateParts[1], 10) - 1;
          let day = parseInt(dateParts[2], 10);
          sheet.getRange(rowIdx, statusCols[j]).setValue(new Date(year, month, day));
        } else {
          sheet.getRange(rowIdx, statusCols[j]).setValue(val);
        }
      } else {
        sheet.getRange(rowIdx, statusCols[j]).setValue('');
      }
    }
    
    // อัปเดตหมายเหตุ (Col T / index 19 -> Col 20)
    sheet.getRange(rowIdx, 20).setValue(projectData.remark || '');
    
    return JSON.stringify({ status: 'success', id: targetId, row: rowIdx });
  } catch (error) {
    return JSON.stringify({ status: 'error', message: error.toString() });
  }
}

// ฟังก์ชันช่วยดึงค่าตัวเลือกใน Dropdown (Data Validation) จากชีตโดยการสแกนคอลัมน์
function getDropdownOptions(sheet, colLetter) {
  try {
    // สแกนแถวที่ 3 ถึง 100 ในคอลัมน์นั้นๆ เพื่อหาเซลล์แรกที่มีกฎการกรองข้อมูล (Validation)
    const range = sheet.getRange(colLetter + "3:" + colLetter + "100");
    const validations = range.getDataValidations();
    let rule = null;
    
    for (let i = 0; i < validations.length; i++) {
      if (validations[i][0]) {
        rule = validations[i][0];
        break;
      }
    }
    
    if (!rule) return [];
    
    const criteria = rule.getCriteriaType();
    if (criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      return rule.getCriteriaValues()[0];
    } else if (criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
      const sourceRange = rule.getCriteriaValues()[0];
      return sourceRange.getValues().flat().filter(function(v) {
        return v !== null && v !== undefined && v.toString().trim() !== '';
      }).map(function(v) { return v.toString().trim(); });
    }
  } catch(e) {
    Logger.log("Error getting validation: " + e.toString());
  }
  return [];
}

// ฟังก์ชันซิงค์รายชื่อเจ้าหน้าที่ลง Google Sheet (อัปเดตชีตตัวเลือกและ Data Validation ในตาราง)
function updateStaffListInSheet(pin, staffList) {
  if (pin !== '888888') {
    return JSON.stringify({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' });
  }

  try {
    if (!staffList || !Array.isArray(staffList) || staffList.length === 0) {
      return JSON.stringify({ status: 'warning', message: 'ไม่มีรายชื่อเจ้าหน้าที่ที่ส่งมา' });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    // 1. ตรวจสอบหรือสร้างชีต "ตัวเลือก" (Dropdown Options)
    let optionSheet = ss.getSheetByName('ตัวเลือก');
    if (!optionSheet) {
      optionSheet = ss.getSheetByName('Dropdown');
    }
    if (!optionSheet) {
      optionSheet = ss.insertSheet('ตัวเลือก');
      optionSheet.getRange(1, 1).setValue('รายชื่อเจ้าหน้าที่สำนักช่าง');
    }

    // เขียนรายชื่อเจ้าหน้าที่ลงในคอลัมน์ A (เริ่มแถวที่ 2)
    optionSheet.getRange("A2:A100").clearContent();
    const values = staffList.map(function(name) { return [name]; });
    optionSheet.getRange(2, 1, values.length, 1).setValues(values);

    // 2. อัปเดต Data Validation ของคอลัมน์ G ถึง J ใน "ตารางติดตามโครงการ"
    const mainSheet = ss.getSheetByName('ตารางติดตามโครงการ');
    if (mainSheet) {
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(staffList, true)
        .setAllowInvalid(true)
        .build();

      // Col G (ผู้สำรวจ), Col H (ออกแบบ), Col I (เขียนแบบ), Col J (ประมาณราคา)
      mainSheet.getRange("G3:J100").setDataValidation(rule);
    }

    return JSON.stringify({
      status: 'success',
      message: 'ซิงค์รายชื่อเจ้าหน้าที่ลง Google Sheet สำเร็จ',
      count: staffList.length
    });
  } catch (err) {
    return JSON.stringify({ status: 'error', message: err.toString() });
  }
}

// =======================================================
// ฟังก์ชันซิงค์ข้อมูลจาก Google Sheet กลับไปยัง Supabase (Auto-Sync)
// =======================================================

// 1. ซิงค์โครงการ 1 แถวจาก Google Sheet ไปยัง Supabase
function syncRowToSupabase(rowIdx) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('ตารางติดตามโครงการ');
    if (!sheet) return;
    
    const row = sheet.getRange(rowIdx, 1, 1, 20).getValues()[0];
    const projectId = row[0] ? parseInt(row[0].toString().trim(), 10) : null;
    const name = row[1] ? row[1].toString().trim() : '';
    
    if (!projectId || !name) return;
    
    const budgetNum = parseFloat((row[2] || 0).toString().replace(/,/g, '')) || 0;
    
    // จัดการวันที่ของทั้ง 7 ขั้นตอน (Col K ถึง Q)
    const statusCols = [10, 11, 12, 13, 14, 15, 16];
    const stepDates = [];
    for (let c = 0; c < statusCols.length; c++) {
      let cellVal = row[statusCols[c]];
      let dStr = '';
      if (cellVal instanceof Date) {
        let y = cellVal.getFullYear();
        let m = String(cellVal.getMonth() + 1).padStart(2, '0');
        let d = String(cellVal.getDate()).padStart(2, '0');
        dStr = `${y}-${m}-${d}`;
      } else if (cellVal) {
        dStr = cellVal.toString().trim();
      }
      stepDates.push(dStr);
    }
    
    const payload = {
      id: projectId,
      name: name,
      budget: budgetNum,
      budget_type: (row[3] || '').toString().trim(),
      budget_year: (row[4] || '').toString().trim(),
      operation_status: (row[5] || '').toString().trim(),
      surveyor: (row[6] || '').toString().trim(),
      designer: (row[7] || '').toString().trim(),
      draftsman: (row[8] || '').toString().trim(),
      estimator: (row[9] || '').toString().trim(),
      step_1_date: stepDates[0] || '',
      step_2_date: stepDates[1] || '',
      step_3_date: stepDates[2] || '',
      step_4_date: stepDates[3] || '',
      step_5_date: stepDates[4] || '',
      step_6_date: stepDates[5] || '',
      step_7_date: stepDates[6] || '',
      remark: (row[19] || '').toString().trim()
    };
    
    const url = SUPABASE_URL + '/rest/v1/projects?on_conflict=id';
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Prefer': 'resolution=merge-duplicates'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    Logger.log("Auto-Sync Row " + rowIdx + " to Supabase: " + response.getContentText());
  } catch (err) {
    Logger.log("Error syncing row to Supabase: " + err.toString());
  }
}

// 2. ซิงค์รายชื่อเจ้าหน้าที่จากชีต "ตัวเลือก" ไปยัง Supabase
function syncStaffSheetToSupabase() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let optionSheet = ss.getSheetByName('ตัวเลือก');
    if (!optionSheet) optionSheet = ss.getSheetByName('Dropdown');
    if (!optionSheet) return;
    
    const values = optionSheet.getRange("A2:A100").getValues();
    const sheetStaffNames = [];
    for (let i = 0; i < values.length; i++) {
      const val = values[i][0] ? values[i][0].toString().trim() : '';
      if (val && !sheetStaffNames.includes(val)) {
        sheetStaffNames.push(val);
      }
    }
    if (sheetStaffNames.length === 0) return;

    // ดึงรายชื่อเดิมจาก Supabase
    const getUrl = SUPABASE_URL + '/rest/v1/dropdown_options?category=eq.team&select=*';
    const getRes = UrlFetchApp.fetch(getUrl, {
      method: 'get',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      },
      muteHttpExceptions: true
    });
    
    const existing = JSON.parse(getRes.getContentText()) || [];
    const existingNames = existing.map(function(item) { return item.item_value ? item.item_value.trim() : ''; });
    
    // หาชื่อที่ยังไม่มีใน Supabase เพื่อ INSERT
    const toInsert = [];
    for (let k = 0; k < sheetStaffNames.length; k++) {
      const name = sheetStaffNames[k];
      if (!existingNames.includes(name)) {
        toInsert.push({
          category: 'team',
          item_value: name,
          sort_order: k + 1
        });
      }
    }

    if (toInsert.length > 0) {
      const postUrl = SUPABASE_URL + '/rest/v1/dropdown_options';
      UrlFetchApp.fetch(postUrl, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
        },
        payload: JSON.stringify(toInsert),
        muteHttpExceptions: true
      });
      Logger.log("Auto-Sync Staff Sheet to Supabase: Added " + toInsert.length + " staff");
    }
  } catch (err) {
    Logger.log("Error syncStaffSheetToSupabase: " + err.toString());
  }
}

// 3. Trigger เมื่อมีการแก้ไขข้อมูลในชีตโดยตรง (Installable Trigger: onEdit)
function onEditTrigger(e) {
  if (!e || !e.range) return;
  try {
    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();
    const row = e.range.getRow();
    
    if (sheetName === 'ตารางติดตามโครงการ' && row >= 3) {
      syncRowToSupabase(row);
    } else if (sheetName === 'ตัวเลือก' || sheetName === 'Dropdown') {
      syncStaffSheetToSupabase();
    }
  } catch (err) {
    Logger.log("onEditTrigger error: " + err.toString());
  }
}

// 4. สร้างเมนูลัดบน Google Sheets
function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('⚡ ระบบติดตามโครงการ')
      .addItem('🔄 ซิงค์โครงการทั้งหมดไปยัง Dashboard ทันที', 'syncAllProjectsToSupabase')
      .addItem('👥 ซิงค์รายชื่อเจ้าหน้าที่ไปยัง Dashboard ทันที', 'syncStaffSheetToSupabase')
      .addItem('🛠️ ติดตั้งระบบซิงค์อัตโนมัติ (On Edit)', 'createInstallableTrigger')
      .addToUi();
  } catch (e) {
    Logger.log("onOpen error: " + e.toString());
  }
}

// 4. ติดตั้ง Trigger อัตโนมัติในคลิกเดียว
function createInstallableTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onEditTrigger') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('onEditTrigger')
    .forSpreadsheet(ss)
    .onEdit()
    .create();
    
  SpreadsheetApp.getUi().alert('✅ ติดตั้งระบบซิงค์อัตโนมัติเรียบร้อยแล้ว!\n\nทุกครั้งที่มีการแก้ไขข้อมูลในชีตนี้ ระบบจะส่งข้อมูลไปอัปเดตบน Dashboard (Vercel) ทันที');
}

// 5. สั่งซิงค์ข้อมูลโครงการทั้งหมดในชีตขึ้น Supabase
function syncAllProjectsToSupabase() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('ตารางติดตามโครงการ');
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  let count = 0;
  for (let r = 3; r <= lastRow; r++) {
    syncRowToSupabase(r);
    count++;
  }
  SpreadsheetApp.getUi().alert('✅ ซิงค์ข้อมูลทั้งหมด ' + count + ' แถวไปยัง Dashboard เรียบร้อยแล้ว');
}

