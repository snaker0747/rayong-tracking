const https = require('https');
const crypto = require('crypto');

const SUPABASE_URL = 'https://awfenzwfywelxmnnalva.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ZadcQEz6xuirM1CT9HGSTw_D1Cw0xdS';

// Protected Supabase Auth account credentials (STORED SECURELY ON SERVER ONLY)
const ADMIN_EMAIL = process.env.ADMIN_SUPABASE_EMAIL || 'admin@rayong.go.th';
const ADMIN_PASSWORD = process.env.ADMIN_SUPABASE_PASSWORD || 'RayongTracking2569#AdminSecure';

// Valid hashes for Admin & Viewer PINs
const ADMIN_SALT = 'rayong_admin_salt_2569';
const ADMIN_HASH = '2e6e132b0942fc8c4d0465a612becc00a72d3d277b4d9bcd2a56f1964fa77c78'; // "4321"

const PIN_SALT = 'rayong_eng_salt_2569';
const VIEWER_PIN_HASH = 'cfaaa0a14f964a541187ad5b8059d179f3b10db92e5d7899ec58616034835399'; // "888888" (ดูได้อย่างเดียว ห้ามแก้ไข)
const ADMIN_PIN_HASH = '400940ee83f0fed35b75e088caee4ea76a93900a236e1ad782ca48d4acbfd96e';  // "987654" (สิทธิ์ Admin แก้ไขได้ทั้งระบบ)

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch(e) {}
        }
        body = body || {};

        let isValid = false;
        let role = '';

        // Mode 1: PIN login (888888 = viewer, 987654 = admin)
        if (body.pin !== undefined) {
            const pinStr = String(body.pin).trim();
            const computedPinHash = crypto.createHash('sha256').update(pinStr + PIN_SALT).digest('hex');
            
            if (computedPinHash === VIEWER_PIN_HASH) {
                // สิทธิ์ Viewer: ดูได้อย่างเดียว ห้ามแก้ไข (ไม่แจก Admin Session Token)
                return res.status(200).json({
                    success: true,
                    role: 'viewer',
                    session: null,
                    message: 'เข้าสู่ระบบในฐานะผู้เข้าชม (ดูได้อย่างเดียว)'
                });
            } else if (computedPinHash === ADMIN_PIN_HASH) {
                // สิทธิ์ Admin: แก้ไขได้ทั้งระบบ (ออก Session Token ให้)
                isValid = true;
                role = 'admin';
            }
        } 
        // Mode 2: Admin Username / Password login (admin / 4321)
        else {
            const username = String(body.username || '').trim();
            const password = String(body.password || '').trim();
            if (username && password) {
                const computedAdminHash = crypto.createHash('sha256').update(password + ADMIN_SALT).digest('hex');
                if (username === 'admin' && computedAdminHash === ADMIN_HASH) {
                    isValid = true;
                    role = 'admin';
                }
            }
        }

        if (!isValid) {
            return res.status(401).json({ success: false, error: 'ข้อมูลยืนยันสิทธิ์ไม่ถูกต้อง' });
        }

        // Authenticate with Supabase Auth to retrieve valid JWT access token
        const authPayload = JSON.stringify({
            email: ADMIN_EMAIL,
            password: ADMIN_PASSWORD
        });

        const tokenRes = await new Promise((resolve, reject) => {
            const authReq = https.request(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(authPayload)
                }
            }, r => {
                let data = '';
                r.on('data', chunk => data += chunk);
                r.on('end', () => resolve({ statusCode: r.statusCode, data }));
            });
            authReq.on('error', reject);
            authReq.write(authPayload);
            authReq.end();
        });

        if (tokenRes.statusCode === 200) {
            const sessionData = JSON.parse(tokenRes.data);
            return res.status(200).json({
                success: true,
                role: role,
                session: {
                    access_token: sessionData.access_token,
                    refresh_token: sessionData.refresh_token,
                    expires_in: sessionData.expires_in,
                    expires_at: sessionData.expires_at,
                    user: {
                        id: sessionData.user?.id,
                        email: sessionData.user?.email,
                        role: sessionData.user?.role
                    }
                }
            });
        } else {
            console.error('Supabase auth failed:', tokenRes.statusCode, tokenRes.data);
            return res.status(500).json({ success: false, error: 'ไม่สามารถสร้างเซสชันความปลอดภัยได้' });
        }
    } catch (err) {
        console.error('Auth endpoint error:', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
