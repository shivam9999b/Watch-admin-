import { supabase, supabaseConfigured, money, escapeHTML } from "./supabase.js";

const notice = document.querySelector(".notice");
const productTable = document.getElementById("productTable");
const orderTable = document.getElementById("orderTable");
let products = [];
let orders = [];

function setNotice(text, isError=false) {
  notice.textContent=text;
  notice.style.color=isError?"#ffb5b5":"#e6d4a9";
}
function cell(row, value) {
  const td=document.createElement("td"); td.textContent=String(value ?? "—"); row.appendChild(td); return td;
}
function updateStats(){
  document.getElementById("productCount").textContent=products.length;
  document.getElementById("orderCount").textContent=orders.length;
  document.getElementById("revenue").textContent=money(orders.filter(o=>o.status!=="Cancelled").reduce((s,o)=>s+Number(o.total||0),0));
  document.getElementById("pendingCount").textContent=orders.filter(o=>o.status==="Pending").length;
}
function renderProducts(){
  productTable.replaceChildren();
  products.forEach(p=>{
    const tr=document.createElement("tr");
    cell(tr,p.name);cell(tr,p.category);cell(tr,money(p.price));
    const td=cell(tr,"");
    const del=document.createElement("button");del.className="btn danger";del.textContent="Delete";
    del.addEventListener("click",()=>deleteProduct(p.id));
    td.appendChild(del);productTable.appendChild(tr);
  });
}
function renderOrders(){
  orderTable.replaceChildren();
  orders.forEach(o=>{
    const tr=document.createElement("tr");
    cell(tr,o.id);cell(tr,o.customer_name);cell(tr,money(o.total));cell(tr,o.payment_method);
    const td=cell(tr,"");
    const select=document.createElement("select");
    ["Pending","Confirmed","Processing","Shipped","Delivered","Cancelled"].forEach(st=>{
      const op=document.createElement("option");op.value=st;op.textContent=st;op.selected=o.status===st;select.appendChild(op);
    });
    select.addEventListener("change",()=>updateOrder(o.id,select.value));
    td.appendChild(select);orderTable.appendChild(tr);
  });
}
async function requireAdmin(){
  if(!supabaseConfigured){setNotice("Supabase configured nahi hai. supabase.js mein Project URL aur anon key add karo.",true);return false;}
  const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user){location.href="login.html";return false;}
  const {data:profile,error:profileError}=await supabase.from("profiles").select("role").eq("id",user.id).maybeSingle();
  if(profileError||profile?.role!=="admin"){
    setNotice("Access denied: is account ka admin role set nahi hai. Admin role database mein secure tareeke se assign karo.",true);
    document.querySelectorAll("button, input, select").forEach(el=>el.disabled=true);
    return false;
  }
  return true;
}
async function loadData(){
  if(!await requireAdmin())return;
  const [p,o]=await Promise.all([
    supabase.from("products").select("*").order("created_at",{ascending:false}),
    supabase.from("orders").select("id,customer_name,total,payment_method,status,created_at").order("created_at",{ascending:false})
  ]);
  if(p.error||o.error){setNotice("Database error: "+(p.error?.message||o.error?.message),true);return;}
  products=p.data||[];orders=o.data||[];
  renderProducts();renderOrders();updateStats();
  setNotice("Supabase connected. Products aur orders database se load hue hain.");
}
document.querySelectorAll(".nav-btn").forEach(b=>b.addEventListener("click",()=>openSection(b.dataset.section)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>openSection(b.dataset.go)));
function openSection(id){
  document.querySelectorAll(".section").forEach(s=>s.classList.toggle("active",s.id===id));
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.section===id));
  document.getElementById("pageTitle").textContent=({dashboard:"Dashboard",products:"Products",orders:"Orders",sales:"Sales"})[id]||"Dashboard";
}
const form=document.getElementById("productForm");
const productImageFile=document.getElementById("productImageFile");
const productImageUrl=document.getElementById("productImage");
const productImagePreview=document.getElementById("productImagePreview");

document.getElementById("addProductBtn").addEventListener("click",()=>form.hidden=!form.hidden);
document.getElementById("cancelProductBtn").addEventListener("click",()=>{
  form.reset();
  productImagePreview.hidden=true;
  productImagePreview.removeAttribute("src");
  form.hidden=true;
});

productImageFile?.addEventListener("change",()=>{
  const file=productImageFile.files?.[0];
  if(!file){
    productImagePreview.hidden=true;
    productImagePreview.removeAttribute("src");
    return;
  }
  if(!file.type.startsWith("image/")){
    setNotice("Sirf image file select karo.",true);
    productImageFile.value="";
    return;
  }
  if(file.size>5*1024*1024){
    setNotice("Image 5 MB se chhoti honi chahiye.",true);
    productImageFile.value="";
    return;
  }
  productImagePreview.src=URL.createObjectURL(file);
  productImagePreview.hidden=false;
});

async function uploadProductImage(){
  const file=productImageFile?.files?.[0];
  if(!file) return productImageUrl.value.trim() || null;
  if(!file.type.startsWith("image/")) throw new Error("Sirf image file select karo.");
  if(file.size>5*1024*1024) throw new Error("Image 5 MB se chhoti honi chahiye.");

  const safeName=file.name.toLowerCase().replace(/[^a-z0-9._-]+/g,"-");
  const filePath=`${Date.now()}-${safeName}`;
  const {error:uploadError}=await supabase.storage
    .from("product-images")
    .upload(filePath,file,{contentType:file.type,upsert:false});
  if(uploadError) throw new Error("Image upload failed: "+uploadError.message);

  return supabase.storage.from("product-images").getPublicUrl(filePath).data.publicUrl;
}
form.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!supabaseConfigured)return setNotice("Supabase config missing.",true);
  const submitButton=form.querySelector('button[type="submit"]');
  submitButton.disabled=true;
  try {
    const imageUrl=await uploadProductImage();
    const payload={
      name:document.getElementById("productName").value.trim(),
      price:Number(document.getElementById("productPrice").value),
      category:document.getElementById("productCategory").value,
      image_url:imageUrl,
      active:true
    };
    if(!payload.name||!Number.isFinite(payload.price)||payload.price<=0){
      setNotice("Valid product name aur price enter karo.",true);
      return;
    }
    const {error}=await supabase.from("products").insert(payload);
    if(error){setNotice("Product save nahi hua: "+error.message,true);return;}
    form.reset();
    productImagePreview.hidden=true;
    productImagePreview.removeAttribute("src");
    form.hidden=true;
    await loadData();
  } catch(error) {
    setNotice(error.message || "Product/image save nahi hua.",true);
  } finally {
    submitButton.disabled=false;
  }
});
async function deleteProduct(id){
  if(!confirm("Kya aap is product ko delete karna chahte hain?"))return;
  const {error}=await supabase.from("products").delete().eq("id",id);
  if(error){setNotice("Delete failed: "+error.message,true);return;}
  await loadData();
}
async function updateOrder(id,status){
  const {error}=await supabase.from("orders").update({status}).eq("id",id);
  if(error){setNotice("Order status update nahi hua: "+error.message,true);return;}
  await loadData();
}
document.getElementById("signOutBtn")?.addEventListener("click",async()=>{
  if(supabaseConfigured)await supabase.auth.signOut();
  location.href="login.html";
});
loadData();
