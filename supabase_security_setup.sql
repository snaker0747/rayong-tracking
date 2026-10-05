-- ========================================================
-- สคริปต์ปรับปรุงความปลอดภัยและโครงสร้างฐานข้อมูล (Supabase)
-- ระบบตารางติดตามโครงการสำนักช่าง เทศบาลนครระยอง 2569
-- ========================================================

-- 1. เพิ่มคอลัมน์จริงในตาราง projects (หากยังไม่มี)
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS supervisor text,
ADD COLUMN IF NOT EXISTS budget_owner text,
ADD COLUMN IF NOT EXISTS delivery_plan_date text,
ADD COLUMN IF NOT EXISTS step_8_date text,
ADD COLUMN IF NOT EXISTS contract_url text;

-- 2. สร้างตาราง Audit Logs สำหรับบันทึกประวัติการเปลี่ยนแปลง
CREATE TABLE IF NOT EXISTS public.project_audit_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id bigint,
    project_name text,
    action text NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE', 'BULK_IMPORT'
    changed_by text DEFAULT 'staff/admin',
    old_data jsonb,
    new_data jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. เปิดใช้งาน Row Level Security (RLS) เพื่อความปลอดภัยสูงสุด
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dropdown_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_audit_logs ENABLE ROW LEVEL SECURITY;

-- 4. ตั้งค่านโยบาย: ประชาชน/บุคคลภายนอก (Anon) อ่านข้อมูลโครงการและตัวเลือกได้อย่างเดียว (Read-Only)
DROP POLICY IF EXISTS "Public Read Only Projects" ON public.projects;
CREATE POLICY "Public Read Only Projects" 
ON public.projects FOR SELECT TO anon, authenticated 
USING (true);

DROP POLICY IF EXISTS "Public Read Only Dropdowns" ON public.dropdown_options;
CREATE POLICY "Public Read Only Dropdowns" 
ON public.dropdown_options FOR SELECT TO anon, authenticated 
USING (true);

-- 5. ตั้งค่านโยบาย: เฉพาะผู้ที่ผ่านการยืนยันตัวตน (Authenticated) จึงจะแก้ไข/เพิ่ม/ลบได้
DROP POLICY IF EXISTS "Admin Full Access Projects" ON public.projects;
CREATE POLICY "Admin Full Access Projects" 
ON public.projects FOR ALL TO authenticated 
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin Full Access Dropdowns" ON public.dropdown_options;
CREATE POLICY "Admin Full Access Dropdowns" 
ON public.dropdown_options FOR ALL TO authenticated 
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admin Full Access Audit" ON public.project_audit_logs;
CREATE POLICY "Admin Full Access Audit" 
ON public.project_audit_logs FOR ALL TO authenticated 
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon Insert Audit Logs" ON public.project_audit_logs;
CREATE POLICY "Anon Insert Audit Logs" 
ON public.project_audit_logs FOR INSERT TO anon 
WITH CHECK (true);

-- 7. เสริม Index เพื่อให้การค้นหาและจัดเรียงข้อมูลเร็วขึ้นในระดับเสี้ยววินาที (Zero Latency)
CREATE INDEX IF NOT EXISTS idx_projects_budget_year ON public.projects (budget_year);
CREATE INDEX IF NOT EXISTS idx_projects_operation_status ON public.projects (operation_status);
CREATE INDEX IF NOT EXISTS idx_projects_budget_type ON public.projects (budget_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_project_id ON public.project_audit_logs (project_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.project_audit_logs (created_at DESC);
