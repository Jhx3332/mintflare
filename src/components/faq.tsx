import { FAQS } from "@/lib/faq-data";

export default function Faq() {
  return (
    <div className="bg-[var(--background)] p-12">
      <div className="container mx-auto px-4 py-12">
        <h2 className="text-3xl font-bold text-center mb-8">Frequently Asked Questions</h2>
        <div className="max-w-3xl mx-auto space-y-4">
          {FAQS.map((item, i) => (
            <div key={i} className="border border-[var(--border)] rounded-lg">
              <details className="group">
                <summary className="flex justify-between items-center font-medium cursor-pointer p-4">
                  <span>{item.question}</span>
                  <span className="transition group-open:rotate-180">
                    <svg
                      fill="none"
                      height="24"
                      shapeRendering="geometricPrecision"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                      viewBox="0 0 24 24"
                      width="24"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                </summary>
                <p className="text-neutral-300 p-4 pt-0 group-open:animate-fadeIn">
                  <div dangerouslySetInnerHTML={{ __html: item.answer }} />
                </p>
              </details>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
