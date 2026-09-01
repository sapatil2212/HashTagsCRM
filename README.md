# #️⃣ HashTags CRM

> The ultimate enterprise CRM and no-code automation platform built on Next.js, MySQL (Prisma), Socket.io, and the official WhatsApp Business (Cloud) API. Empower your team with a real-time shared team inbox, visual Kanban pipelines, automated broadcasts, contact management, AI automation, and dynamic multi-business appointment booking.

---

## 🚀 Key Modules & Features

### 📥 Real-Time Shared Inbox
- **Multi-Agent Collaboration:** Connect official WhatsApp Business numbers and collaborate under a single fast, unified interface.
- **Thread Assignment & Realtime Sync:** Assign conversations to specific agents, transition statuses (Open, Pending, Resolved), and sync instantaneously over WebSockets (Socket.io).
- **Rich Media & Interactive Messages:** Send and receive text, images, documents, audio, videos, interactive button templates, and quick replies.

### 📊 Visual Kanban Pipelines
- **Chat-Linked Deals:** Drag-and-drop deals linked directly to active WhatsApp customer threads.
- **Stage & Value Tracking:** Define custom stages, assign monetary values, and visualize total pipeline revenue in real-time.
- **Direct Actions:** Trigger stage transitions or dispatch template messages straight from the pipeline view.

### 📢 Targeted Broadcast Campaigns
- **Meta-Approved Templates:** Schedule or instantly dispatch broadcast campaigns to targeted audiences.
- **Dynamic Variables & Custom Fields:** Personalize broadcasts with contact names and bespoke custom attributes.
- **Live Campaign Analytics:** Track sent, delivered, read, failed, and response rates in real-time.

### 🔌 No-Code Flow & Automation Builder
- **Visual Automation Trees:** Construct intelligent logic workflows triggered by incoming keywords, contact actions, or schedules.
- **Branching & Conditions:** Route flows dynamically based on tags, intent, business hours, and attributes.
- **Action Nodes:** Trigger webhooks, auto-tag contacts, dispatch templates, or insert delay nodes.

### 🤖 Multi-Segment AI Assistant & Booking
- **Dual AI Engine:** Powered by Google Gemini with automatic failover to OpenAI / OpenRouter models.
- **Intelligent Appointment Workflows:** Real-time doctor/specialist availability lookup, smart slot calculation, conflict prevention, and confirmation.
- **Strict Compliance & Guardrails:** Built-in safeguards preventing medical prescriptions, enforcing compliant responses, and enabling seamless human agent takeover.

---

## 🛠️ Technological Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS, Framer Motion, Lucide Icons, Modern Brand Orange Theme (`#FFA500`)
- **Backend & Database:** Node.js custom server (`server.js`), Prisma ORM, MySQL, Socket.io for bidirectional realtime communication
- **WhatsApp Gateway:** Official Meta WhatsApp Cloud API (Compliant, high-throughput delivery)

---

## ⚙️ Environment Configuration

Copy the sample environment configuration file:
```bash
cp .env.example .env
```

### Required Configuration Variables

| Key | Description |
| :--- | :--- |
| `DATABASE_URL` | MySQL database connection string. |
| `NEXTAUTH_SECRET` | Secret key for session authentication and JWT tokens. |
| `NEXTAUTH_URL` | Base URL of the application (e.g. `http://localhost:3000`). |
| `ENCRYPTION_KEY` | 64-character hex string (32 bytes) for encrypting WhatsApp API credentials. |
| `META_APP_SECRET` | Used to verify HMAC signatures of incoming WhatsApp webhooks. |
| `NEXT_PUBLIC_SOCKET_URL` | URL of the Socket.io WebSocket server. |

> Connecting a WhatsApp number: follow [docs/META_WHATSAPP_SETUP.md](docs/META_WHATSAPP_SETUP.md)
> for the full Meta-side walkthrough (Phone Number ID, WABA ID, permanent access
> token, app secret, verify token and webhook callback URL).

### Optional AI & Integration Keys

| Key | Description |
| :--- | :--- |
| `GEMINI_API_KEY` | Google Gemini API Key for autonomous AI replies and intent recognition. |
| `OPENAI_API_KEY` | OpenAI API Key for fallback model handling. |
| `RESEND_API_KEY` | Resend API key for transactional emails (OTP, password reset, demo booking). |

---

## 🚀 Quick Start Guide

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/sapatil2212/HashTagsCRM.git
cd HashTagsCRM
npm install
```

### 2. Configure Database & Prisma
```bash
npx prisma generate
npx prisma db push
```

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to access the HashTags CRM application.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — feel free to customize, host, and deploy for your business.
