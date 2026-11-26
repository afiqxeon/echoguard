export interface ClinicalSampleNote {
  label: string;
  text: string;
}

export const SAMPLE_CLINICAL_NOTES: ClinicalSampleNote[] = [
  {
    label: "ER — Acute Chest Pain",
    text: "Patient John Doe (DOB: 04/12/1982, Insurance ID: AETNA992841, Phone: 555-019-8372) reports acute chest tightness and shortness of breath persisting for 48 hours.",
  },
  {
    label: "Pediatrics — High Fever & Rash",
    text: "Pediatric patient Maya Lin (DOB: 09/18/2020, MRN: PED-44109, Parent Phone: 555-234-9910) brought in by mother Sarah Lin for 3 days of persistent 39.2C fever, maculopapular rash on trunk, and decreased oral intake.",
  },
  {
    label: "Endocrinology — Uncontrolled Diabetes",
    text: "Follow-up for Robert Alvarez (DOB: 11/03/1965, Email: r.alvarez65@example.com, Insurance ID: BCBS-774120) with Type 2 Diabetes Mellitus. Fasting blood glucose averaging 245 mg/dL over the past two weeks with increased polyuria and mild peripheral neuropathy.",
  },
  {
    label: "Neurology — Migraine vs. TIA",
    text: "Patient Elena Rostova (DOB: 02/27/1978, Phone: 555-882-4105, SSN: 123-45-6789) presents with sudden-onset right-sided visual aura, throbbing left temporal headache, and transient slurred speech lasting 15 minutes.",
  },
];
