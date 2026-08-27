import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { emailLayout, emailHeading, emailSubtitle, emailText, emailDetails } from "@/lib/email/template";

export async function POST(req: NextRequest) {
  try {
    const { name, email, phone, date, time } = await req.json();

    if (!name || !email || !phone || !date || !time) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Env resolution mirrors every other mail route in this app (auth/signup,
    // auth/verify, auth/reset-password-otp, super-admin/approve,
    // super-admin/users): accept either the SMTP_* names or the EMAIL_* names
    // the project actually deploys with, and strip surrounding quotes that
    // survive .env parsing.
    //
    // This route previously read SMTP_* only. Against an EMAIL_*-only
    // environment `smtpHost` was undefined, so the send block never ran: the
    // endpoint returned 500 "SMTP host not configured" in production and,
    // worse, reported success in development while sending nothing. The
    // quote-stripping matters just as much — EMAIL_PORT is quoted in .env, and
    // parseInt('"465"') is NaN, which would break the connection even once the
    // host resolved.
    const cleanEnv = (val: string | undefined): string => {
      if (!val) return "";
      return val.replace(/^["']|["']$/g, "");
    };

    const superAdmin = cleanEnv(process.env.SUPER_ADMIN_USERNAME) || "admin@hashtagscrm.com";

    // Setup SMTP Transporter
    const smtpHost = cleanEnv(process.env.SMTP_HOST || process.env.EMAIL_HOST);
    const rawPort = process.env.SMTP_PORT || process.env.EMAIL_PORT;
    const smtpPort = rawPort ? parseInt(cleanEnv(rawPort)) : 587;
    const smtpUser = cleanEnv(process.env.SMTP_USER || process.env.EMAIL_USERNAME);
    const smtpPass = cleanEnv(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD);
    const smtpFrom = cleanEnv(process.env.SMTP_FROM) || smtpUser || "admin@hashtagscrm.com";

    // Developer Fallback: Log demo booking details to terminal console
    console.log(`
\n=== [NEW DEMO BOOKING REGISTERED] ===
Customer: ${name} (${email})
Phone:    ${phone}
Slot:     ${date} at ${time}
Notification sent to Super Admin: ${superAdmin}
======================================\n
    `);

    if (smtpHost && smtpUser && smtpPass) {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      // 1. Confirmation Email to the user booking the demo
      const userMailOptions = {
        from: smtpFrom,
        to: email,
        subject: "HashTags CRM Product Demo Confirmed!",
        text: `Hi ${name},\n\nYour HashTags CRM product walkthrough has been scheduled for ${date} at ${time}.\n\nMeeting link: Google Meet (the link will be attached to your calendar invite).\n\nBest regards,\nThe HashTags CRM Team`,
        html: emailLayout({
          title: "Your HashTags CRM demo is confirmed",
          preview: `Your demo is booked for ${date} at ${time}`,
          center: false,
          contentHtml:
            emailHeading("Demo confirmed 🎉") +
            emailSubtitle(`Hi ${name}, your product walkthrough is booked. Here are your details:`) +
            emailDetails([
              { label: "Date", value: date },
              { label: "Time slot", value: time, highlight: true },
              { label: "Location", value: "Google Meet (invite attached to calendar)" },
            ]) +
            emailText("Need to reschedule or have questions? Just reply to this email.", { size: 12 }),
        }),
      };

      // 2. Notification Email to the Super Admin
      const adminMailOptions = {
        from: smtpFrom,
        to: superAdmin,
        subject: `New Demo Walkthrough Booked: ${name}`,
        text: `New HashTags CRM product demo booking.\n\nDetails:\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nSlot: ${date} at ${time}`,
        html: emailLayout({
          title: "New demo booking",
          preview: `${name} booked a demo for ${date} at ${time}`,
          center: false,
          contentHtml:
            emailHeading("New demo booking") +
            emailSubtitle("A client scheduled a HashTags CRM product walkthrough. Lead details:") +
            emailDetails([
              { label: "Name", value: name },
              { label: "Email", value: `<a href="mailto:${email}" style="color:#059669;text-decoration:none;">${email}</a>` },
              { label: "Phone", value: phone },
              { label: "Date", value: date },
              { label: "Time slot", value: time, highlight: true },
            ]),
        }),
      };

      try {
        await Promise.all([
          transporter.sendMail(userMailOptions),
          transporter.sendMail(adminMailOptions),
        ]);
      } catch (mailErr: any) {
        console.error("Failed to send demo emails:", mailErr);
        // Do not block user in development if SMTP details fail
        if (process.env.NODE_ENV === "development") {
          return NextResponse.json({ 
            success: true, 
            note: "SMTP send failed, but booking logged locally." 
          });
        }
        return NextResponse.json({ error: `SMTP Send Error: ${mailErr.message || mailErr}` }, { status: 500 });
      }
    } else {
      if (process.env.NODE_ENV !== "development") {
        return NextResponse.json({ error: "SMTP host not configured on backend." }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Book demo backend error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
