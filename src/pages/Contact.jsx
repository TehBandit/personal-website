import { useState } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";

function Contact() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState("");

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || "Something went wrong.");
        setStatus("error");
      } else {
        setStatus("success");
        setForm({ name: "", email: "", message: "" });
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col items-center px-4 py-12">
        <div className="w-full max-w-lg">
          <h1 className="text-3xl font-bold mb-2">Get in Touch</h1>
          <p className="text-gray-500 mb-8">
            Send me a message and I'll get back to you as soon as I can.
          </p>

          {status === "success" ? (
            <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-8 text-center">
              <p className="text-xl font-semibold text-blue-700 mb-2">Message sent!</p>
              <p className="text-gray-600">Thanks for reaching out. I'll be in touch soon.</p>
              <button
                className="mt-6 text-sm text-blue-600 underline"
                onClick={() => setStatus("idle")}
              >
                Send another message
              </button>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-5 border-2 border-blue-300 rounded-xl bg-blue-50 p-8"
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="name" className="text-sm font-semibold text-gray-700">
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  placeholder="Your name"
                  value={form.name}
                  onChange={handleChange}
                  className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="email" className="text-sm font-semibold text-gray-700">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={handleChange}
                  className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="message" className="text-sm font-semibold text-gray-700">
                  Message
                </label>
                <textarea
                  id="message"
                  name="message"
                  required
                  rows={6}
                  placeholder="What's on your mind?"
                  value={form.message}
                  onChange={handleChange}
                  className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                />
              </div>

              {status === "error" && (
                <p className="text-sm text-red-600">{errorMsg}</p>
              )}

              <button
                type="submit"
                disabled={status === "loading"}
                className="self-end rounded-lg bg-blue-400 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition-colors disabled:opacity-60"
              >
                {status === "loading" ? "Sending…" : "Send Message"}
              </button>
            </form>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default Contact;
