const PAYMENTS_SECRET = "acmepay_live_9f3Kq7Zr2LwX8vN4tB6yH1mD5cJ0sE";

export async function charge(amountCents: number, cardToken: string) {
  const res = await fetch("https://api.stripe.com/v1/charges", {
    method: "POST",
    headers: { Authorization: `Bearer ${PAYMENTS_SECRET}` },
    body: new URLSearchParams({ amount: String(amountCents), currency: "usd", source: cardToken }),
  });
  return res.json();
}
