import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: "All fields are required." });
  }

  if (name.length > 200 || message.length > 5000 || email.length > 320) {
    return res.status(400).json({ error: "One or more fields exceed allowed length." });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  try {
    await resend.emails.send({
      from: "Contact Form <onboarding@resend.dev>",
      to: "taylor.marcus99@gmail.com",
      replyTo: email,
      subject: `New message from ${esc(name)}`,
      text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
      html: `
        <p><strong>Name:</strong> ${esc(name)}</p>
        <p><strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
        <p><strong>Message:</strong></p>
        <p style="white-space: pre-wrap;">${esc(message)}</p>
      `,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Resend error:", err);
    return res.status(500).json({ error: "Failed to send message. Please try again." });
  }
}
