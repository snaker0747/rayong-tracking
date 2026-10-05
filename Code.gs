function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('ระบบติดตามงานโครงการ')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
// แทนที่ '1wuiyJv8PQGZ-4_1bjv-awp182cO0KsPuszYeAb29cfo' ด้วย ID ของ Google Sheet
const SPREADSHEET_ID = '1wuiyJv8PQGZ-4_1bjv-awp182cO0KsPuszYeAb29cfo';
const SUPABASE_URL = 'https://awfenzwfywelxmnnalva.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ZadcQEz6xuirM1CT9HGSTw_D1Cw0xdS';
const CONTRACT_FOLDER_ID = '1rIF8diGWH-V8qal5nkTQHCVFDlbqbSAv';

// ฟังก์ชันขอรับ Bearer Token สิทธิ์ Authenticated ใน Apps Script เพื่อผ่าน RLS ของ Supabase
function getSupabaseAuthHeader() {
  try {
    const cache = CacheService.getScriptCache();
    const token = cache ? cache.get('supabase_auth_token') : null;
    if (token) {
      return 'Bearer ' + token;
    }
    
    const authUrl = SUPABASE_URL + '/auth/v1/token?grant_type=password';
    const authRes = UrlFetchApp.fetch(authUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'apikey': SUPABASE_ANON_KEY },
      payload: JSON.stringify({
        email: 'admin@rayong.go.th',
        password: 'RayongTracking2569#AdminSecure'
      }),
      muteHttpExceptions: true
    });
    
    if (authRes.getResponseCode() === 200) {
      const data = JSON.parse(authRes.getContentText());
      if (data.access_token) {
        if (cache) cache.put('supabase_auth_token', data.access_token, 3000);
        return 'Bearer ' + data.access_token;
      }
    }
  } catch (e) {
    Logger.log("getSupabaseAuthHeader warning: " + e.toString());
  }
  return 'Bearer ' + SUPABASE_ANON_KEY;
}

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
    } else if (action === 'update_system_dropdowns' || action === 'sync_dropdowns') {
      result = updateSystemDropdownsInSheet(pin, payload.dropdowns || payload);
    } else if (action === 'upload_contract_pdf' || action === 'upload_file') {
      result = handleContractPdfUpload(pin, payload);
    } else if (action === 'delete_contract_pdf' || action === 'delete_file') {
      result = handleContractPdfDelete(pin, payload);
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
  if (pin !== '888888' && pin !== '987654') {
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
          // ตรวจสอบว่าถ้าเป็นข้อความธรรมดา มีรูปแบบของวันที่ซ่อนอยู่หรือไม่ (เช่น 14/6/2567, 14 ส.ค. 2569, ก.พ. 69)
          if (statusText !== '' && (
              /[\d]{1,2}[\/\-][\d]{1,2}[\/\-][\d]{2,4}/.test(statusText) ||
              /[\d]{1,2}\s*[^\d\s]+\s*[\d]{2,4}/.test(statusText) ||
              /^(ม\.ค|ก\.พ|มี\.ค|เม\.ย|พ\.ค|มิ\.ย|ก\.ค|ส\.ค|ก\.ย|ต\.ค|พ\.ย|ธ\.ค)/.test(statusText) ||
              /^(มกรา|กุมภา|มีนา|เมษา|พฤษภา|มิถุนา|กรกฎา|สิงหา|กันยา|ตุลา|พฤศจิกา|ธันวา)/.test(statusText)
          )) {
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
      
        let remarkVal = row[19] !== undefined ? row[19].toString().trim() : '';
        let supVal = '';
        let boVal = '';
        let contractUrlVal = '';
        let sm = remarkVal.match(/\[ผู้ควบคุมงาน\s*:\s*([^\]]+)\]/i);
        if (sm) supVal = sm[1].trim();
        let bom = remarkVal.match(/\[เจ้าของงบประมาณ\s*:\s*([^\]]+)\]/i);
        if (bom) boVal = bom[1].trim();
        let cm = remarkVal.match(/\[(?:ไฟล์สัญญา|เอกสารสัญญา|สัญญาPDF)\s*:\s*([^\]]+)\]/i);
        if (cm) contractUrlVal = cm[1].trim();

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
            estimator: row[9], // ประมาณราคา (Col J / index 9)
            supervisor: supVal // ผู้ควบคุมงาน
          },
          supervisor: supVal,
          budgetOwner: boVal,
          budget_owner: boVal,
          contractUrl: contractUrlVal,
          contract_url: contractUrlVal,
          remark: remarkVal, // หมายเหตุ (Col T / index 19)
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
        for (let col = 10; col <= 17; col++) {
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
          estimator: estimatorOptions,
          supervisor: surveyorOptions
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
  if (pin !== '888888' && pin !== '987654') {
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
    
    // ตรวจสอบชื่อโครงการซ้ำ เพื่อป้องกันข้อมูลซ้ำซ้อนในระบบ
    const projName = (projectData.name || '').toString().replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    if (projName) {
      for (let i = 2; i < data.length; i++) {
        const rowId = data[i][0] ? data[i][0].toString().trim() : '';
        const existingName = data[i][1] ? data[i][1].toString().replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim() : '';
        if (existingName.toLowerCase() === projName.toLowerCase() && rowId !== targetId) {
          return JSON.stringify({
            status: 'error',
            message: 'มีโครงการชื่อ "' + projName + '" อยู่ในระบบแล้ว (ลำดับ ID: #' + rowId + ')'
          });
        }
      }
    }

    // อัปเดตข้อมูลพื้นฐาน (Col B - F)
    sheet.getRange(rowIdx, 2).setValue(projName); // รายการ
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
    
    // อัปเดตวันที่ในขั้นตอน (Col K ถึง R)
    const statusCols = [11, 12, 13, 14, 15, 16, 17, 18];
    const statuses = projectData.statusesText || [
      projectData.step_1_date,
      projectData.step_2_date,
      projectData.step_3_date,
      projectData.step_4_date,
      projectData.step_5_date,
      projectData.step_6_date,
      projectData.step_7_date,
      projectData.step_8_date
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
  if (pin !== '888888' && pin !== '987654') {
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
    const lastRowOpt = Math.max(100, optionSheet.getLastRow());
    optionSheet.getRange(2, 1, lastRowOpt, 1).clearContent();
    const values = staffList.map(function(name) { return [name]; });
    if (values.length > 0) {
      optionSheet.getRange(2, 1, values.length, 1).setValues(values);
    }

    // 2. อัปเดต Data Validation ของคอลัมน์ G ถึง J ใน "ตารางติดตามโครงการ"
    const mainSheet = ss.getSheetByName('ตารางติดตามโครงการ');
    if (mainSheet) {
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(staffList, true)
        .setAllowInvalid(true)
        .build();

      const lastRowMain = Math.max(100, mainSheet.getLastRow());
      // Col G (ผู้สำรวจ), Col H (ออกแบบ), Col I (เขียนแบบ), Col J (ประมาณราคา)
      mainSheet.getRange(3, 7, Math.max(1, lastRowMain - 2), 4).setDataValidation(rule);
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

// ฟังก์ชันซิงค์ตัวเลือกทั้งหมดในระบบลง Google Sheet (อัปเดตชีตตัวเลือกและ Data Validation ในตาราง)
function updateSystemDropdownsInSheet(pin, dropdowns) {
  if (pin !== '888888' && pin !== '987654') {
    return JSON.stringify({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' });
  }

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    // 1. ตรวจสอบหรือสร้างชีต "ตัวเลือก" (Dropdown Options Backup)
    let optionSheet = ss.getSheetByName('ตัวเลือก');
    if (!optionSheet) {
      optionSheet = ss.getSheetByName('Dropdown');
    }
    if (!optionSheet) {
      optionSheet = ss.insertSheet('ตัวเลือก');
    }

    // กำหนดหัวตารางของชีต "ตัวเลือก" แถวที่ 1
    const headers = [
      ['รายชื่อเจ้าหน้าที่สำนักช่าง', 'ประเภทงบประมาณ', 'สถานะการดำเนินงาน', 'ขั้นตอนการดำเนินงาน (7 ขั้นตอน)', 'เจ้าของงบประมาณ']
    ];
    optionSheet.getRange(1, 1, 1, 5).setValues(headers);
    optionSheet.getRange(1, 1, 1, 5)
      .setFontWeight('bold')
      .setBackground('#f1f5f9');

    // ล้างข้อมูลเดิมตั้งแต่แถวที่ 2 เป็นต้นไป (คอลัมน์ A ถึง E)
    const maxRows = Math.max(100, optionSheet.getLastRow());
    optionSheet.getRange(2, 1, maxRows, 5).clearContent();

    const teamList = (dropdowns && Array.isArray(dropdowns.team)) ? dropdowns.team : [];
    const budgetTypeList = (dropdowns && Array.isArray(dropdowns.budget_type)) ? dropdowns.budget_type : [];
    const opStatusList = (dropdowns && Array.isArray(dropdowns.operation_status)) ? dropdowns.operation_status : [];
    const stepNameList = (dropdowns && Array.isArray(dropdowns.step_name)) ? dropdowns.step_name : [];
    const budgetOwnerList = (dropdowns && Array.isArray(dropdowns.budget_owner)) ? dropdowns.budget_owner : [];

    // เขียนคอลัมน์ A: รายชื่อเจ้าหน้าที่
    if (teamList.length > 0) {
      const teamVals = teamList.map(function(t) { return [t]; });
      optionSheet.getRange(2, 1, teamVals.length, 1).setValues(teamVals);
    }
    // เขียนคอลัมน์ B: ประเภทงบประมาณ
    if (budgetTypeList.length > 0) {
      const btVals = budgetTypeList.map(function(b) { return [b]; });
      optionSheet.getRange(2, 2, btVals.length, 1).setValues(btVals);
    }
    // เขียนคอลัมน์ C: สถานะการดำเนินงาน
    if (opStatusList.length > 0) {
      const opVals = opStatusList.map(function(o) { return [o]; });
      optionSheet.getRange(2, 3, opVals.length, 1).setValues(opVals);
    }
    // เขียนคอลัมน์ D: ชื่อขั้นตอนทั้ง 7
    if (stepNameList.length > 0) {
      const stepVals = stepNameList.map(function(s) { return [s]; });
      optionSheet.getRange(2, 4, stepVals.length, 1).setValues(stepVals);
    }
    // เขียนคอลัมน์ E: เจ้าของงบประมาณ
    if (budgetOwnerList.length > 0) {
      const boVals = budgetOwnerList.map(function(bo) { return [bo]; });
      optionSheet.getRange(2, 5, boVals.length, 1).setValues(boVals);
    }

    // 2. อัปเดต Data Validation และ Header ในชีต "ตารางติดตามโครงการ"
    const mainSheet = ss.getSheetByName('ตารางติดตามโครงการ');
    if (mainSheet) {
      const lastRowMain = Math.max(100, mainSheet.getLastRow());
      const numRows = Math.max(1, lastRowMain - 2);

      // Col D (คอลัมน์ที่ 4): ประเภทงบประมาณ
      if (budgetTypeList.length > 0) {
        const btRule = SpreadsheetApp.newDataValidation()
          .requireValueInList(budgetTypeList, true)
          .setAllowInvalid(true)
          .build();
        mainSheet.getRange(3, 4, numRows, 1).setDataValidation(btRule);
      }

      // Col F (คอลัมน์ที่ 6): การดำเนินงาน
      if (opStatusList.length > 0) {
        const opRule = SpreadsheetApp.newDataValidation()
          .requireValueInList(opStatusList, true)
          .setAllowInvalid(true)
          .build();
        mainSheet.getRange(3, 6, numRows, 1).setDataValidation(opRule);
      }

      // Col G ถึง J (คอลัมน์ที่ 7 ถึง 10): รายชื่อเจ้าหน้าที่ (สำรวจ, ออกแบบ, เขียนแบบ, ประมาณราคา)
      if (teamList.length > 0) {
        const staffRule = SpreadsheetApp.newDataValidation()
          .requireValueInList(teamList, true)
          .setAllowInvalid(true)
          .build();
        mainSheet.getRange(3, 7, numRows, 4).setDataValidation(staffRule);
      }

      // Col K เป็นต้นไป (คอลัมน์ที่ 11 เป็นต้นไป): หัวตารางขั้นตอนงานแถวที่ 2
      if (stepNameList.length > 0) {
        for (let i = 0; i < stepNameList.length; i++) {
          mainSheet.getRange(2, 11 + i).setValue(stepNameList[i]);
        }
      }
    }

    return JSON.stringify({
      status: 'success',
      message: 'ซิงค์และสำรองข้อมูลตัวเลือกทั้งหมดลง Google Sheet สำเร็จ',
      counts: {
        team: teamList.length,
        budget_type: budgetTypeList.length,
        budget_owner: budgetOwnerList.length,
        operation_status: opStatusList.length,
        step_name: stepNameList.length
      }
    });
  } catch (err) {
    return JSON.stringify({ status: 'error', message: err.toString() });
  }
}

// ฟังก์ชันซิงค์ตัวเลือกทั้งหมดจาก Supabase ลง Google Sheet
function syncAllDropdownsFromSupabaseToSheet() {
  try {
    const getUrl = SUPABASE_URL + '/rest/v1/dropdown_options?select=*&order=sort_order.asc';
    const res = UrlFetchApp.fetch(getUrl, {
      method: 'get',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      },
      muteHttpExceptions: true
    });
    const data = JSON.parse(res.getContentText()) || [];
    const dropdowns = {
      team: [],
      budget_type: [],
      budget_owner: [],
      operation_status: [],
      step_name: []
    };
    data.forEach(function(item) {
      if (dropdowns[item.category]) {
        dropdowns[item.category].push(item.item_value);
      }
    });

    const result = updateSystemDropdownsInSheet('888888', dropdowns);
    if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getUi) {
      SpreadsheetApp.getUi().alert('✅ ซิงค์ตัวเลือกทั้งหมดจากระบบลง Google Sheet สำเร็จเรียบร้อย!');
    }
    return result;
  } catch (err) {
    Logger.log("Error syncAllDropdownsFromSupabaseToSheet: " + err.toString());
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
    
    // จัดการวันที่ของขั้นตอน (Col K ถึง R)
    const statusCols = [10, 11, 12, 13, 14, 15, 16, 17];
    const stepDates = [];
    for (let c = 0; c < statusCols.length; c++) {
      let cellVal = row[statusCols[c]];
      let dStr = '';
      if (cellVal instanceof Date) {
        let y = cellVal.getFullYear();
        if (y > 2400) y -= 543; // Guard against Buddhist era date offset
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
      step_8_date: stepDates[7] || '',
      remark: (row[19] || '').toString().trim()
    };
    
    const url = SUPABASE_URL + '/rest/v1/projects?on_conflict=id';
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': getSupabaseAuthHeader(),
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
    
    const lastRowOpt = Math.max(2, optionSheet.getLastRow());
    const values = optionSheet.getRange(2, 1, lastRowOpt - 1, 1).getValues();
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
    const cleanStaffKey = function(s) {
      return (s || '')
        .toString()
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^(นาย|นางสาว|นาง|น\.ส\.|ว่าที่\s*ร\.ต\.)\s*/, '')
        .trim()
        .toLowerCase();
    };
    const existingKeys = existing.map(function(item) { 
      return cleanStaffKey(item.item_value); 
    });
    
    // หาชื่อที่ยังไม่มีใน Supabase เพื่อ INSERT (ป้องกันชื่อซ้ำ 100%)
    const toInsert = [];
    for (let k = 0; k < sheetStaffNames.length; k++) {
      const name = sheetStaffNames[k];
      const key = cleanStaffKey(name);
      if (key && !existingKeys.includes(key)) {
        toInsert.push({
          category: 'team',
          item_value: name,
          sort_order: existing.length + toInsert.length + 1
        });
        existingKeys.push(key);
      }
    }

    if (toInsert.length > 0) {
      const postUrl = SUPABASE_URL + '/rest/v1/dropdown_options';
      UrlFetchApp.fetch(postUrl, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': getSupabaseAuthHeader()
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
      .addItem('⚙️ ซิงค์ตัวเลือกทั้งหมดไปยังชีต Backup ทันที', 'syncAllDropdownsFromSupabaseToSheet')
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

// =======================================================
// 6. ระบบอัปโหลดและจัดเก็บเอกสารสัญญา (PDF) ลง Google Drive
// =======================================================

// ฟังก์ชันสำหรับกดปุ่ม "เรียกใช้" (Run) ใน Apps Script 1 ครั้ง เพื่อเปิดสิทธิ์ Create/Write ไฟล์ลง Google Drive (OAuth Scope: https://www.googleapis.com/auth/drive)
function authorizeDriveAccess() {
  try {
    const folder = DriveApp.getFolderById(CONTRACT_FOLDER_ID);
    Logger.log("กำลังทดสอบการสร้างไฟล์ในโฟลเดอร์: " + folder.getName());
    
    // สร้างไฟล์ทดสอบเพื่อบังคับให้ Google ขอสิทธิ์ Write Access เต็มรูปแบบ
    const testFile = folder.createFile("test_permission_ok.txt", "Google Drive Permission Verified Successfully", MimeType.PLAIN_TEXT);
    testFile.setTrashed(true); // ย้ายไฟล์ทดสอบลงถังขยะทันที
    
    Logger.log("✅ ยืนยันสิทธิ์สร้างและบันทึกไฟล์ลง Google Drive สำเร็จสมบูรณ์ 100%!");
    return "✅ ยืนยันสิทธิ์สร้างและบันทึกไฟล์ลง Google Drive สำเร็จสมบูรณ์ 100%!";
  } catch (e) {
    Logger.log("❌ เกิดข้อผิดพลาด: " + e.toString());
    throw e;
  }
}

function handleContractPdfUpload(pin, payload) {
  if (pin !== '888888' && pin !== '987654') {
    return JSON.stringify({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' });
  }

  try {
    const fileData = payload.fileData; // Base64 string
    const originalName = payload.fileName || 'เอกสารสัญญา.pdf';
    const projectId = (payload.projectId !== undefined && payload.projectId !== null) ? payload.projectId.toString().trim() : '';
    const mimeType = payload.mimeType || 'application/pdf';

    if (!fileData) {
      return JSON.stringify({ status: 'error', message: 'ไม่พบข้อมูลไฟล์ (fileData Base64 is required)' });
    }

    // 1. เปิดโฟลเดอร์ Google Drive ตาม Folder ID ที่กำหนด
    let folder;
    try {
      folder = DriveApp.getFolderById(CONTRACT_FOLDER_ID);
    } catch (fe) {
      Logger.log("Folder not found by ID, fallback creating folder: " + fe.toString());
      folder = DriveApp.createFolder("เอกสารสัญญา_สำนักช่าง");
    }

    // 2. แปลง base64 เป็น binary blob
    const decodedBytes = Utilities.base64Decode(fileData);
    
    // ตั้งชื่อไฟล์อย่างเป็นระบบ เช่น สัญญา_โครงการID_ชื่อเดิม.pdf
    let finalFileName = originalName;
    if (projectId && !originalName.includes(projectId)) {
      finalFileName = 'สัญญา_โครงการ' + projectId + '_' + originalName;
    }

    const blob = Utilities.newBlob(decodedBytes, mimeType, finalFileName);

    // 3. สร้างไฟล์ลงโฟลเดอร์ใน Google Drive
    const file = folder.createFile(blob);
    // ตั้งสิทธิ์การเข้าถึงให้อ่านได้ผ่านลิงก์โดยตรง
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (se) {
      Logger.log("Set sharing notice: " + se.toString());
    }

    const fileId = file.getId();
    const previewUrl = 'https://drive.google.com/file/d/' + fileId + '/preview';
    const webViewLink = file.getUrl();
    const downloadUrl = 'https://drive.google.com/uc?export=download&id=' + fileId;

    return JSON.stringify({
      status: 'success',
      fileId: fileId,
      fileName: finalFileName,
      fileSize: file.getSize(),
      viewUrl: previewUrl,
      webViewLink: webViewLink,
      downloadUrl: downloadUrl,
      message: 'อัปโหลดเอกสารสัญญาขึ้น Google Drive เรียบร้อยแล้ว'
    });
  } catch (err) {
    Logger.log("Upload contract PDF error: " + err.toString());
    return JSON.stringify({
      status: 'error',
      message: 'เกิดข้อผิดพลาดในการบันทึกไฟล์ลง Google Drive: ' + err.toString()
    });
  }
}

// ฟังก์ชันลบไฟล์เอกสารสัญญาออกจาก Google Drive เพื่อประหยัดพื้นที่
function handleContractPdfDelete(pin, payload) {
  if (pin !== '888888' && pin !== '987654') {
    return JSON.stringify({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' });
  }

  try {
    const fileUrl = payload.fileUrl || '';
    let fileId = payload.fileId || '';

    // หากไม่ได้ระบุ fileId มาโดยตรง ให้สกัด fileId ออกจาก URL
    if (!fileId && fileUrl) {
      const m1 = fileUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (m1) {
        fileId = m1[1];
      } else {
        const m2 = fileUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (m2) fileId = m2[1];
      }
    }

    if (!fileId) {
      return JSON.stringify({ status: 'error', message: 'ไม่พบ ID ของไฟล์ที่จะลบ' });
    }

    // นำไฟล์ลงถังขยะใน Google Drive (ย้ายไป Trash เพื่อประหยัดโควต้าพื้นที่และไม่แสดงในโฟลเดอร์)
    const file = DriveApp.getFileById(fileId);
    file.setTrashed(true);
    Logger.log("✅ ย้ายไฟล์ลงถังขยะ Google Drive เรียบร้อยแล้ว File ID: " + fileId);

    return JSON.stringify({
      status: 'success',
      fileId: fileId,
      message: 'ลบไฟล์ออกจาก Google Drive เรียบร้อยแล้ว'
    });
  } catch (err) {
    Logger.log("❌ Delete contract PDF error: " + err.toString());
    return JSON.stringify({
      status: 'error',
      message: 'เกิดข้อผิดพลาดในการลบไฟล์จาก Google Drive: ' + err.toString()
    });
  }
}



