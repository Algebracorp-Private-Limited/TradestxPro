"use client";

import { FormEvent, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  "https://studious-rotary-phone-j9vxx45gpwjh54jv-5000.app.github.dev";

type SignupForm = {
  name: string;
  email: string;
  gender: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  password: string;
  confirmPassword: string;
};

export default function SignupPage() {
  const [form, setForm] = useState<SignupForm>({
    name: "",
    email: "",
    gender: "",
    phone: "",
    city: "",
    state: "",
    country: "India",
    password: "",
    confirmPassword: "",
  });

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function updateField(field: keyof SignupForm, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (form.password !== form.confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    if (form.password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.message || "Signup failed.");
        return;
      }

      setMessage(
        `Signup successful. Your Free Plan account was created. User ID: ${data.userId}`
      );
    } catch {
      setMessage(
        "Unable to connect to TradestXPro. Please check that the backend is running."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#05070b] px-6 py-12 text-white">
      <div className="mx-auto max-w-2xl">
        <a
          href="/"
          className="text-sm text-slate-400 hover:text-white"
        >
          ← Back to TradestXPro
        </a>

        <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl sm:p-10">
          <div className="mb-8">
            <p className="text-sm text-slate-500">
              Create your account
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">
              Join TradestXPro
            </h1>
            <p className="mt-3 text-slate-400">
              Start with the Free Plan and upgrade whenever you are ready.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm text-slate-300">
                Full Name
              </label>
              <input
                required
                value={form.name}
                onChange={(event) =>
                  updateField("name", event.target.value)
                }
                className="w-full rounded-xl border border-white/10 bg-[#0b111a] px-4 py-3 outline-none focus:border-white/30"
                placeholder="Your full name"
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Email
                </label>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    updateField("email", event.target.value)
                  }
                  className="w-full rounded-xl border border-white/10 bg-[#0b111a] px-4 py-3 outline-none focus:border-white/30"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Gender
                </label>
                <select
                  value={form.gender}
                  onChange={(event) =>
                    updateField("gender", event.target.value)
                  }
                  className="w-full rounded-xl border border-white/10 bg-[#0b111a] px-4 py-3 outline-none focus:border-white/30"
                >
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                  <option value="Prefer not to say">
                    Prefer not to say
                  </option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-300">
                Phone
              </label>
              <input
                required
                type="tel"
                value={form.phone}
                onChange={(event) =>
                  updateField("phone", event.target.value)
                }
                className="w-full rounded-xl border border-white/10 bg-[#0b111a] px-4 py-3 outline-none focus:border-white/30"
                placeholder="10-digit mobile number"
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  City
                </label>
                <input
                  value={form.city}
                  onChange={(event) =>
                    updateField("city", event.target.value)
                  }
                  className="w-full rounded-xl border border-white/10 bg-[#0b111a] px-4 py-3 outline-none focus:border-white/30"
                  placeholder="City"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  State
                </label>
                <input
                  value={form.state}
                  onChange={(event) =>
                    updateField("state", event.target.value)
                  }
                  className="w-full rounded-xl border border-white/10 bg-[#0b111a] px-4 py-3 outline-none focus:border-white/30"
                  placeholder="State"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-300">
                Country
              </label>
              <input
                required
                value={form.country}
                onChange={(event) =>
                  updateField("country", event.target.value)
                }
                className="w-full rounded-xl border border-white/10 bg-[#0b111a] px-4 py-3 outline-none focus:border-white/30"
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Password
                </label>
                <input
                  required
                  type="password"
                  value={form.password}
                  onChange={(event) =>
                    updateField("password", event.target.value)
                  }
                  className="w-full rounded-xl border border-white/10 bg-[#0b111a] px-4 py-3 outline-none focus:border-white/30"
                  placeholder="Minimum 8 characters"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  Confirm Password
                </label>
                <input
                  required
                  type="password"
                  value={form.confirmPassword}
                  onChange={(event) =>
                    updateField("confirmPassword", event.target.value)
                  }
                  className="w-full rounded-xl border border-white/10 bg-[#0b111a] px-4 py-3 outline-none focus:border-white/30"
                  placeholder="Re-enter password"
                />
              </div>
            </div>

            {message && (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-white px-5 py-3.5 text-sm font-semibold text-slate-950 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Creating account..." : "Create Free Account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{" "}
            <a href="/login" className="text-white hover:underline">
              Login
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
