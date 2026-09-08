import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "fs";
const schema = JSON.parse(readFileSync("/Users/majhar/AGL/awning/schema/website-spec.schema.json","utf8"));
const ajv = new Ajv({allErrors:true, strict:false});
addFormats(ajv);
const validate = ajv.compile(schema);

const base = {
  specVersion:1,
  site:{businessName:"Adelaide Halal Meats",industry:"butcher",style:"premium-modern",tone:"warm",locale:"en-AU",currency:"AUD"},
  theme:{primary:"#173B2A",secondary:"#F5EEDC",accent:"#C9A227",neutral:"#1A1A1A",
         headingFont:"Playfair Display",bodyFont:"Inter",radius:"md",density:"comfortable"},
  pages:[{id:"home",path:"/",title:"Adelaide Halal Meats",sections:[
    {id:"hero-1",type:"hero",variant:"split",props:{
      heading:"Fresh halal meat, cut the way you like it",
      subheading:"Family-run butcher in Mile End. Free delivery across metro Adelaide on orders over $80.",
      primaryCta:{label:"See this week's specials",href:"#specials",style:"primary",icon:"arrow"},
      trustPoints:["Halal certified","Delivery Tue & Fri","Open 7 days"]}},
    {id:"svc-1",type:"services",variant:"cards",props:{heading:"What we do",items:[
      {title:"Fresh lamb & goat",description:"Whole, half or cut to order.",icon:"beef"},
      {title:"Weekly specials",description:"New prices every Monday.",icon:"star"}]}}
  ]}]
};

function run(name, mut){
  const doc = JSON.parse(JSON.stringify(base));
  if (mut) mut(doc);
  const ok = validate(doc);
  const err = ok ? "" : "  → " + validate.errors.slice(0,2).map(e=>`${e.instancePath||"/"} ${e.message}`).join(" | ");
  console.log((ok?"PASS ":"REJECT").padEnd(7), name.padEnd(52), err);
}

console.log("=== the schema is the guardrail ===\n");
run("valid butcher spec", null);
run("AI invents a testimonial (no source field)", d=>d.pages[0].sections.push(
  {id:"t1",type:"testimonials",variant:"cards",props:{items:[{quote:"Best meat in Adelaide, always fresh and the staff are lovely!",author:"Sarah M."}]}}));
run("AI fakes source as 'ai_generated'", d=>d.pages[0].sections.push(
  {id:"t1",type:"testimonials",variant:"cards",props:{items:[{quote:"Absolutely brilliant service every time.",author:"Sarah M.",source:"ai_generated"}]}}));
run("genuine customer-supplied testimonial", d=>d.pages[0].sections.push(
  {id:"t1",type:"testimonials",variant:"cards",props:{items:[{quote:"Been coming here for years, never disappointed.",author:"Sarah M.",location:"Torrensville",rating:5,source:"customer_supplied"}]}}));
run("invented component type 'parallaxHero'", d=>d.pages[0].sections.push({id:"px1",type:"parallaxHero",variant:"cool",props:{}}));
run("real type, invented variant 'ultra'", d=>d.pages[0].sections.push({id:"hx1",type:"hero",variant:"ultra",props:{heading:"Hi"}}));
run("countdown with no end date (evergreen timer)", d=>d.pages[0].sections.push(
  {id:"cd1",type:"countdown",variant:"cards",props:{heading:"Hurry, ends soon!"}}));
run("countdown with a real deadline", d=>d.pages[0].sections.push(
  {id:"cd1",type:"countdown",variant:"cards",props:{heading:"Christmas orders close",endsAt:"2026-12-20T17:00:00+10:30"}}));
run("image with no alt text (WCAG)", d=>d.pages[0].sections[0].props.image={assetId:"asset_ab12cd34"});
run("font outside the closed set", d=>d.theme.headingFont="Comic Sans MS");
run("smuggled prop 'customHtml'", d=>d.pages[0].sections[0].props.customHtml="<script>fetch('//evil')</script>");
run("javascript: URL in a CTA", d=>d.pages[0].sections[0].props.primaryCta.href="javascript:alert(1)");
run("hero heading 180 chars (blows the layout)", d=>d.pages[0].sections[0].props.heading="x".repeat(180));
run("non-hex colour", d=>d.theme.primary="dark green");
